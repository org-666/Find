-- ============================================================
-- Find · 正式版匹配引擎（替换掉试玩模式的那套合成候选人）
--
-- 为什么要放在数据库里：
-- 用户只能读自己那一行（RLS），拿客户端密钥根本看不到别人的需求，
-- 所以匹配必须在数据库侧做——而且要 security definer，
-- 但**只把模糊距离和时段重叠返回给调用方，绝不返回对方身份**，
-- 这样才守得住"不展示人"这条产品原则。
-- ============================================================

-- ---------- 1. 距离计算（纯函数，可复用，将来模块 C 定位也要用）----------
create or replace function public.grid_distance_m(p_a text, p_b text)
returns double precision
language sql
immutable
as $$
  select case
    when p_a is null or p_b is null then null
    when p_a !~ '^-?[0-9.]+,-?[0-9.]+$' or p_b !~ '^-?[0-9.]+,-?[0-9.]+$' then null
    else 2 * 6371000 * asin(
      least(1, sqrt(
        power(sin(radians(split_part(p_b, ',', 1)::float8 - split_part(p_a, ',', 1)::float8) / 2), 2)
        + cos(radians(split_part(p_a, ',', 1)::float8))
          * cos(radians(split_part(p_b, ',', 1)::float8))
          * power(sin(radians(split_part(p_b, ',', 2)::float8 - split_part(p_a, ',', 2)::float8) / 2), 2)
      ))
    )
  end;
$$;

comment on function public.grid_distance_m is '两个网格坐标之间的距离（米）；坐标非法或缺失返回 null';

-- ---------- 2. 模糊距离文案：对外永远只说"XX 米内" ----------
create or replace function public.distance_label(p_meters double precision)
returns text
language sql
immutable
as $$
  select case
    when p_meters is null then '附近'
    when p_meters <= 200 then '200 米内'
    when p_meters <= 500 then '500 米内'
    when p_meters <= 1000 then '1 公里内'
    else '附近'
  end;
$$;

-- ============================================================
-- 3. matches：一次配对（两个人 + 双方各自的决定）
-- ============================================================
create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  moment_a        uuid not null references public.moments (id) on delete cascade,
  moment_b        uuid not null references public.moments (id) on delete cascade,
  user_a          uuid not null references auth.users (id) on delete cascade,
  user_b          uuid not null references auth.users (id) on delete cascade,
  a_decision      text not null default 'pending' check (a_decision in ('pending', 'go', 'skip')),
  b_decision      text not null default 'pending' check (b_decision in ('pending', 'go', 'skip')),
  distance_m      double precision,
  overlap_minutes integer,
  -- AI 生成的第一轮确认（双方看到的是同一句）
  place           text,
  eta_minutes     integer,
  confirm_message text,
  activity_detail text,
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'expired')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matches_two_sides check (user_a <> user_b)
);

create index if not exists matches_user_a_idx on public.matches (user_a, created_at desc);
create index if not exists matches_user_b_idx on public.matches (user_b, created_at desc);
-- 同两个人之间只允许存在一条还活着的配对
create unique index if not exists matches_active_pair_idx
  on public.matches (least(user_a, user_b), greatest(user_a, user_b))
  where status in ('pending', 'confirmed');

drop trigger if exists matches_touch_updated_at on public.matches;
create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 4. sessions：双方都点「去」之后开的临时局
-- ============================================================
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null unique references public.matches (id) on delete cascade,
  status     text not null default 'open' check (status in ('open', 'closed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

-- ============================================================
-- 5. 临时对话的消息：局结束就**物理删除**（不留记录）
-- ============================================================
create table if not exists public.session_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  sender     uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text', 'status')),
  body       text not null check (char_length(btrim(body)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists session_messages_session_idx on public.session_messages (session_id, created_at);

-- ============================================================
-- 6. RLS：当事人才能看见自己那一局；写操作全走下面的函数
-- ============================================================
alter table public.matches enable row level security;
alter table public.sessions enable row level security;
alter table public.session_messages enable row level security;

drop policy if exists "matches_select_own" on public.matches;
create policy "matches_select_own"
  on public.matches for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
  on public.sessions for select to authenticated
  using (exists (
    select 1 from public.matches m
    where m.id = match_id and (select auth.uid()) in (m.user_a, m.user_b)
  ));

drop policy if exists "session_messages_select_own" on public.session_messages;
create policy "session_messages_select_own"
  on public.session_messages for select to authenticated
  using (exists (
    select 1 from public.sessions s
    join public.matches m on m.id = s.match_id
    where s.id = session_id and (select auth.uid()) in (m.user_a, m.user_b)
  ));

grant select on public.matches, public.sessions, public.session_messages to authenticated;

-- ============================================================
-- 7. 发起匹配：把我的需求放进池子并尝试配对
--    返回的只有——配对 id、模糊距离、重叠分钟；**没有对方身份**
-- ============================================================
create or replace function public.request_match(
  p_max_distance_m double precision default 1500,
  p_min_overlap_minutes integer default 15
)
returns table (
  match_id uuid,
  activity_detail text,
  distance_label text,
  overlap_minutes integer,
  is_initiator boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mine public.moments;
  v_peer public.moments;
  v_distance double precision;
  v_overlap integer;
  v_match_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_mine
  from public.moments
  where user_id = v_uid and status = 'searching'
  order by created_at desc
  limit 1;

  if v_mine.id is null then
    raise exception 'NO_ACTIVE_MOMENT' using errcode = 'P0002';
  end if;

  -- 已经有活着的配对了就直接返回它，不要重复配
  select m.id into v_match_id
  from public.matches m
  where (m.user_a = v_uid or m.user_b = v_uid) and m.status in ('pending', 'confirmed')
  order by m.created_at desc
  limit 1;

  if v_match_id is not null then
    return query
      select m.id, m.activity_detail, public.distance_label(m.distance_m), m.overlap_minutes, (m.user_a = v_uid)
      from public.matches m where m.id = v_match_id;
    return;
  end if;

  -- 找最佳候选：同活动、时段重叠够久、距离够近、别人也在等
  select m.* into v_peer
  from public.moments m
  where m.user_id <> v_uid
    and m.status = 'searching'
    and m.window_end > now()
    and m.activity_tag = v_mine.activity_tag
    and m.activity_detail = v_mine.activity_detail
    and m.time_window && v_mine.time_window
    and round(extract(epoch from (
          least(m.window_end, v_mine.window_end) - greatest(m.window_start, v_mine.window_start)
        )) / 60) >= p_min_overlap_minutes
    and (
      public.grid_distance_m(m.location_grid, v_mine.location_grid) is null
      or public.grid_distance_m(m.location_grid, v_mine.location_grid) <= p_max_distance_m
    )
  order by
    public.grid_distance_m(m.location_grid, v_mine.location_grid) nulls last,
    m.created_at
  limit 1;

  if v_peer.id is null then
    return; -- 没人在等，返回空
  end if;

  v_distance := public.grid_distance_m(v_peer.location_grid, v_mine.location_grid);
  v_overlap := round(extract(epoch from (
    least(v_peer.window_end, v_mine.window_end) - greatest(v_peer.window_start, v_mine.window_start)
  )) / 60);

  insert into public.matches (moment_a, moment_b, user_a, user_b, distance_m, overlap_minutes, activity_detail)
  values (v_peer.id, v_mine.id, v_peer.user_id, v_uid, v_distance, v_overlap, v_mine.activity_detail)
  returning id into v_match_id;

  -- 双方的需求都标成已配对
  update public.moments set status = 'matched' where id in (v_peer.id, v_mine.id);

  return query
    select v_match_id, v_mine.activity_detail, public.distance_label(v_distance), v_overlap, false;
end;
$$;

comment on function public.request_match is '发起匹配；只返回模糊距离和重叠时长，不返回对方是谁';

-- ============================================================
-- 8. 写入 AI 生成的第一轮确认（双方看到同一句）
-- ============================================================
create or replace function public.set_match_proposal(
  p_match_id uuid,
  p_place text,
  p_eta_minutes integer,
  p_confirm_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  update public.matches
  set place = p_place,
      eta_minutes = p_eta_minutes,
      confirm_message = p_confirm_message
  where id = p_match_id
    and (user_a = v_uid or user_b = v_uid)
    and confirm_message is null;  -- 谁先写谁说了算，避免两边各生成一句
end;
$$;

-- ============================================================
-- 9. 我当前这一局（含双方各自的决定，但不含对方身份）
-- ============================================================
create or replace function public.get_my_match()
returns table (
  match_id uuid,
  activity_detail text,
  distance_label text,
  overlap_minutes integer,
  place text,
  eta_minutes integer,
  confirm_message text,
  my_decision text,
  peer_decision text,
  status text,
  session_id uuid,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  return query
  select
    m.id,
    m.activity_detail,
    public.distance_label(m.distance_m),
    m.overlap_minutes,
    m.place,
    m.eta_minutes,
    m.confirm_message,
    case when m.user_a = v_uid then m.a_decision else m.b_decision end,
    case when m.user_a = v_uid then m.b_decision else m.a_decision end,
    m.status,
    s.id,
    s.expires_at
  from public.matches m
  left join public.sessions s on s.match_id = m.id
  where (m.user_a = v_uid or m.user_b = v_uid)
    and m.status in ('pending', 'confirmed')
  order by m.created_at desc
  limit 1;
end;
$$;

-- ============================================================
-- 10. 回应：去 / 算了；双方都去 → 开临时局
-- ============================================================
create or replace function public.respond_match(p_match_id uuid, p_decision text)
returns table (status text, my_decision text, peer_decision text, session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_session_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_decision not in ('go', 'skip') then
    raise exception 'BAD_DECISION' using errcode = '22023';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.id is null then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_uid not in (v_match.user_a, v_match.user_b) then
    raise exception 'NOT_YOUR_MATCH' using errcode = '42501';
  end if;

  -- 记下我的决定
  if v_match.user_a = v_uid then
    update public.matches set a_decision = p_decision where id = p_match_id returning * into v_match;
  else
    update public.matches set b_decision = p_decision where id = p_match_id returning * into v_match;
  end if;

  -- 任何一方说算了，这一局就结束，双方各自回到匹配池
  if v_match.a_decision = 'skip' or v_match.b_decision = 'skip' then
    update public.matches set status = 'declined' where id = p_match_id;
    update public.moments set status = 'searching'
      where id in (v_match.moment_a, v_match.moment_b);
    return query select 'declined'::text, v_match.a_decision, v_match.b_decision, null::uuid;
    return;
  end if;

  -- 双方都去 → 开临时局
  if v_match.a_decision = 'go' and v_match.b_decision = 'go' then
    update public.matches set status = 'confirmed' where id = p_match_id;

    insert into public.sessions (match_id, expires_at)
    values (p_match_id, now() + interval '90 minutes')
    on conflict (match_id) do update set status = 'open'
    returning id into v_session_id;
  end if;

  return query select v_match.status, v_match.a_decision, v_match.b_decision, v_session_id;
end;
$$;

-- ============================================================
-- 11. 临时对话：发消息 / 读消息 / 结束（结束即物理删除，不留记录）
-- ============================================================
create or replace function public.send_session_message(
  p_session_id uuid,
  p_kind text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_kind not in ('text', 'status') then raise exception 'BAD_KIND' using errcode = '22023'; end if;

  if not exists (
    select 1 from public.sessions s
    join public.matches m on m.id = s.match_id
    where s.id = p_session_id and s.status = 'open' and v_uid in (m.user_a, m.user_b)
  ) then
    raise exception 'SESSION_NOT_OPEN' using errcode = '42501';
  end if;

  insert into public.session_messages (session_id, sender, kind, body)
  values (p_session_id, v_uid, p_kind, btrim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.get_session_messages(p_session_id uuid, p_since timestamptz default null)
returns table (id uuid, mine boolean, kind text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  if not exists (
    select 1 from public.sessions s
    join public.matches m on m.id = s.match_id
    where s.id = p_session_id and v_uid in (m.user_a, m.user_b)
  ) then
    raise exception 'NOT_YOUR_SESSION' using errcode = '42501';
  end if;

  return query
  select sm.id, (sm.sender = v_uid), sm.kind, sm.body, sm.created_at
  from public.session_messages sm
  where sm.session_id = p_session_id
    and (p_since is null or sm.created_at > p_since)
  order by sm.created_at;
end;
$$;

create or replace function public.close_session(p_session_id uuid, p_reason text default 'done')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  if not exists (
    select 1 from public.sessions s
    join public.matches m on m.id = s.match_id
    where s.id = p_session_id and v_uid in (m.user_a, m.user_b)
  ) then
    raise exception 'NOT_YOUR_SESSION' using errcode = '42501';
  end if;

  -- 不留记录：消息物理删除
  delete from public.session_messages where session_id = p_session_id;
  update public.sessions set status = 'closed', closed_at = now() where id = p_session_id;
  update public.matches m set status = 'expired'
    where m.id = (select match_id from public.sessions where id = p_session_id);
  update public.moments set status = 'expired'
    where id in (
      select moment_a from public.matches where id = (select match_id from public.sessions where id = p_session_id)
      union
      select moment_b from public.matches where id = (select match_id from public.sessions where id = p_session_id)
    );
end;
$$;

-- 到点自动关局（可用 pg_cron 定时调用；先提供函数）
create or replace function public.expire_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.sessions set status = 'closed', closed_at = now()
    where status = 'open' and expires_at <= now()
    returning id, match_id
  )
  select count(*) into v_count from expired;

  delete from public.session_messages sm
  where sm.session_id in (select id from public.sessions where status = 'closed');

  return v_count;
end;
$$;

-- ---------- 权限：只给已登录用户执行，不给 anon ----------
revoke all on function public.request_match(double precision, integer) from public, anon;
revoke all on function public.set_match_proposal(uuid, text, integer, text) from public, anon;
revoke all on function public.get_my_match() from public, anon;
revoke all on function public.respond_match(uuid, text) from public, anon;
revoke all on function public.send_session_message(uuid, text, text) from public, anon;
revoke all on function public.get_session_messages(uuid, timestamptz) from public, anon;
revoke all on function public.close_session(uuid, text) from public, anon;

grant execute on function public.request_match(double precision, integer) to authenticated;
grant execute on function public.set_match_proposal(uuid, text, integer, text) to authenticated;
grant execute on function public.get_my_match() to authenticated;
grant execute on function public.respond_match(uuid, text) to authenticated;
grant execute on function public.send_session_message(uuid, text, text) to authenticated;
grant execute on function public.get_session_messages(uuid, timestamptz) to authenticated;
grant execute on function public.close_session(uuid, text) to authenticated;
