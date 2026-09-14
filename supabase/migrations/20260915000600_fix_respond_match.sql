-- ============================================================
-- 修 respond_match 的两个返回错误（双用户实测抓出来的）
--
-- 1. 我方/对方标反了：
--    request_match 建配对时把对方存成 user_a、发起人存成 user_b，
--    而函数直接把 a_decision / b_decision 当作"我方/对方"返回，导致读出来是反的。
--    现在按 auth.uid() 判断哪边是我。
--
-- 2. 状态没刷新：
--    update 了数据库里的 status，但返回的却是本地变量里的旧值，
--    所以"双方都去"之后返回的还是 pending。现在显式同步
--    （界面那边是回头再查一次，所以没受影响，但这个返回值本身是错的，必须修）。
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
  v_mine text;
  v_peer text;
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

  if v_match.user_a = v_uid then
    update public.matches set a_decision = p_decision where id = p_match_id returning * into v_match;
  else
    update public.matches set b_decision = p_decision where id = p_match_id returning * into v_match;
  end if;

  -- 任何一方说算了 → 这一局结束，两边需求都放回池子
  if v_match.a_decision = 'skip' or v_match.b_decision = 'skip' then
    update public.matches set status = 'declined' where id = p_match_id;
    update public.moments set status = 'searching' where id in (v_match.moment_a, v_match.moment_b);
    v_match.status := 'declined';

    v_mine := case when v_match.user_a = v_uid then v_match.a_decision else v_match.b_decision end;
    v_peer := case when v_match.user_a = v_uid then v_match.b_decision else v_match.a_decision end;
    return query select v_match.status, v_mine, v_peer, null::uuid;
    return;
  end if;

  -- 双方都去 → 开临时局
  if v_match.a_decision = 'go' and v_match.b_decision = 'go' then
    update public.matches set status = 'confirmed' where id = p_match_id;
    v_match.status := 'confirmed';

    insert into public.sessions (match_id, expires_at)
    values (p_match_id, now() + interval '90 minutes')
    on conflict (match_id) do update set status = 'open'
    returning id into v_session_id;
  end if;

  -- 按"我"的视角返回，而不是按 a/b
  v_mine := case when v_match.user_a = v_uid then v_match.a_decision else v_match.b_decision end;
  v_peer := case when v_match.user_a = v_uid then v_match.b_decision else v_match.a_decision end;

  return query select v_match.status, v_mine, v_peer, v_session_id;
end;
$$;

revoke all on function public.respond_match(uuid, text) from public, anon;
grant execute on function public.respond_match(uuid, text) to authenticated;
