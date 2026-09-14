-- ============================================================
-- 修补：说了「算了」之后，短时间内不要和同一个人再配上
--
-- 不修的话会出现死循环：A 说算了 → 双方需求回到池子 → B 的客户端轮询发现没配对
-- → 又去 request_match → 又配上 A → A 再次看到确认卡，被反复骚扰。
-- ============================================================

create or replace function public.request_match(
  p_max_distance_m double precision default 1500,
  p_min_overlap_minutes integer default 15,
  p_decline_cooldown_minutes integer default 30
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

  select m.id into v_match_id
  from public.matches m
  where (m.user_a = v_uid or m.user_b = v_uid)
    and m.status in ('pending', 'confirmed')
  order by m.created_at desc
  limit 1;

  if v_match_id is not null then
    return query
      select m.id, m.activity_detail, public.distance_label(m.distance_m), m.overlap_minutes, (m.user_a = v_uid)
      from public.matches m where m.id = v_match_id;
    return;
  end if;

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
    -- 刚被我（或对方）拒过的人，冷却期内不再配
    and not exists (
      select 1 from public.matches mx
      where mx.status = 'declined'
        and mx.updated_at > now() - make_interval(mins => p_decline_cooldown_minutes)
        and (
          (mx.user_a = v_uid and mx.user_b = m.user_id)
          or (mx.user_b = v_uid and mx.user_a = m.user_id)
        )
    )
  order by
    public.grid_distance_m(m.location_grid, v_mine.location_grid) nulls last,
    m.created_at
  limit 1;

  if v_peer.id is null then
    return;
  end if;

  v_distance := public.grid_distance_m(v_peer.location_grid, v_mine.location_grid);
  v_overlap := round(extract(epoch from (
    least(v_peer.window_end, v_mine.window_end) - greatest(v_peer.window_start, v_mine.window_start)
  )) / 60);

  insert into public.matches (moment_a, moment_b, user_a, user_b, distance_m, overlap_minutes, activity_detail)
  values (v_peer.id, v_mine.id, v_peer.user_id, v_uid, v_distance, v_overlap, v_mine.activity_detail)
  returning id into v_match_id;

  update public.moments set status = 'matched' where id in (v_peer.id, v_mine.id);

  return query
    select v_match_id, v_mine.activity_detail, public.distance_label(v_distance), v_overlap, false;
end;
$$;

revoke all on function public.request_match(double precision, integer, integer) from public, anon;
grant execute on function public.request_match(double precision, integer, integer) to authenticated;
