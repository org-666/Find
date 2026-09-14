-- ============================================================
-- Find · 模块 A：用户与认证
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴执行（可重复执行）
--
-- architecture.md 里 users 的字段是：
--   id, nickname, avatar, age, city, location_grid, created_at
-- 这里做了两处落地调整：
--   1. 存 birthday（生日）而不是 age —— 年龄会随时间变化，存生日才能自动算准
--   2. avatar 落成 avatar_url（Storage 里的公开地址）
-- ============================================================

-- ---------- 1. users 表 ----------
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  nickname      text        not null check (char_length(btrim(nickname)) between 1 and 20),
  avatar_url    text,
  birthday      date        not null,
  city          text        not null check (char_length(btrim(city)) between 1 and 30),
  location_grid text,                                  -- 模块 C 定位时才写入，形如 "grid:31.23,121.47"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table  public.users is 'Find 用户资料（与 auth.users 一对一）';
comment on column public.users.birthday is '出生日期，年龄由它实时计算，只保留 18-30 岁';
comment on column public.users.location_grid is '经纬度网格化到 100m 后的字符串，对外只暴露模糊距离';

-- ---------- 2. updated_at 自动维护 ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- ---------- 3. 年龄门槛：18-30（数据库兜底） ----------
-- 前端会先拦一次，服务端 Server Action 再拦一次，这里是最后一道防线：
-- 就算有人绕过界面直接调 API，也写不进非法年龄的数据。
create or replace function public.enforce_users_age()
returns trigger
language plpgsql
as $$
declare
  v_age int;
begin
  -- age(current_date, birthday) 得到「几年几个月几天」，取年份部分就是周岁
  v_age := date_part('year', age(current_date, new.birthday))::int;

  if v_age < 18 or v_age > 30 then
    raise exception 'AGE_OUT_OF_RANGE'
      using errcode = 'check_violation',
            detail  = format('当前 %s 岁，Find 仅面向 18-30 岁用户', v_age);
  end if;

  return new;
end;
$$;

drop trigger if exists users_enforce_age on public.users;
create trigger users_enforce_age
  before insert or update of birthday on public.users
  for each row execute function public.enforce_users_age();

-- ---------- 4. 行级安全（RLS）：只能读写自己那一行 ----------
alter table public.users enable row level security;

drop policy if exists "users_select_self" on public.users;
create policy "users_select_self"
  on public.users for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self"
  on public.users for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self"
  on public.users for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 客户端用到的权限（RLS 仍然是最终闸门）
grant select, insert, update on public.users to authenticated;

-- ---------- 5. 头像 Storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,                                     -- 单张最大 2MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 约定：文件路径必须是 "{用户id}/xxx.jpg"，下面的策略靠这个前缀做归属判断
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');
