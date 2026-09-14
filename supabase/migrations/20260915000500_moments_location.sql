-- ============================================================
-- 补：moments 表缺 location_grid 列
--
-- 为什么必须加在 moments 上而不是只放在 users 上：
-- 匹配看的是"发这条需求的时候人在哪"，而不是"资料里填的城市"。
-- 一个人今天在 A 地、明天在 B 地，定位应该跟着需求走。
--
-- 之前漏了这一列，而 plpgsql 创建函数时不校验列名，
-- 所以 request_match 里引用 m.location_grid 要到真正匹配时才报错。
-- ============================================================

alter table public.moments
  add column if not exists location_grid text;

comment on column public.moments.location_grid is '发需求时的网格化位置（100m 精度）；匹配只看距离档位，绝不对外暴露精确坐标';

-- 给正在等人的人建个部分索引：匹配时只扫这些行
create index if not exists moments_searching_idx
  on public.moments (activity_tag, activity_detail, window_start)
  where status = 'searching';
