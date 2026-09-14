-- ============================================================
-- Find · 模块 B：说需求（AI 解析）
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴执行（可重复执行）
-- 本地 Supabase 会自动按文件名顺序执行 supabase/migrations/ 下的所有文件
--
-- architecture.md 里 moments 的字段是：
--   id, user_id, raw_input, activity_tag, time_window, status, created_at
-- 这里做了两处落地调整：
--   1. time_window 做成"生成列"（由 window_start / window_end 算出来），
--      因为直接插 range 字面量容易踩时区格式的坑；生成列照样能用 && 做重叠查询，
--      模块 C 里"同时段"就是一句 time_window && tstzrange(now(), now() + interval '2 hours')
--   2. 多一个 activity_detail：activity_tag 是粗分类（运动/吃饭/…），
--      但确认页要问的是"你是想打羽毛球，对吧"，得存具体那件事
-- ============================================================

create table if not exists public.moments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  raw_input       text        not null check (char_length(btrim(raw_input)) between 1 and 200),
  activity_tag    text        not null check (activity_tag in ('运动', '吃饭', '自习', '游戏', '其他')),
  activity_detail text        not null check (char_length(btrim(activity_detail)) between 1 and 30),
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  time_window     tstzrange generated always as (tstzrange(window_start, window_end, '[)')) stored,
  status          text        not null default 'searching'
                              check (status in ('searching', 'matched', 'expired', 'cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint moments_window_order check (window_end > window_start)
);

comment on table  public.moments is 'Find 需求（一条 = 一个用户此刻想做的一件事）';
comment on column public.moments.activity_tag is '粗分类，用于模块 C 的匹配池分桶';
comment on column public.moments.activity_detail is '具体活动名，用于"你是想打羽毛球，对吧"这句确认';
comment on column public.moments.time_window is '生成列：匹配只看时间段重叠，不看成具体几点';

-- 模块 C 要按"同时段 + 同活动 + 附近"筛人，先把索引起好
create index if not exists moments_time_window_idx on public.moments using gist (time_window);
create index if not exists moments_status_idx on public.moments (status, created_at desc);
create index if not exists moments_user_idx on public.moments (user_id, created_at desc);

-- updated_at 自动维护（函数在模块 A 的迁移里已经建过）
drop trigger if exists moments_touch_updated_at on public.moments;
create trigger moments_touch_updated_at
  before update on public.moments
  for each row execute function public.touch_updated_at();

-- ---------- RLS：只能读写自己的需求 ----------
alter table public.moments enable row level security;

drop policy if exists "moments_select_self" on public.moments;
create policy "moments_select_self"
  on public.moments for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "moments_insert_self" on public.moments;
create policy "moments_insert_self"
  on public.moments for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "moments_update_self" on public.moments;
create policy "moments_update_self"
  on public.moments for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "moments_delete_self" on public.moments;
create policy "moments_delete_self"
  on public.moments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.moments to authenticated;
