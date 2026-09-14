/**
 * 模块 A 用到的数据形状与常量（只覆盖 users 表，其他模块的表后面再加）
 */

/** 对应 public.users 一行 */
export type UserProfile = {
  id: string;
  nickname: string;
  avatar_url: string | null;
  birthday: string; // YYYY-MM-DD
  city: string;
  location_grid: string | null; // 模块 C 才会写入，这里先留字段
  created_at: string;
  updated_at: string;
};

export const USERS_TABLE = "users";
export const MOMENTS_TABLE = "moments";
/** 头像存放的 Storage bucket，见 supabase/0001_users.sql */
export const AVATAR_BUCKET = "avatars";

/** 需求状态：searching 在匹配池里，其余是终态 */
export type MomentStatus = "searching" | "matched" | "expired" | "cancelled";

/** 对应 public.moments 一行（模块 B 写入，模块 C 消费） */
export type Moment = {
  id: string;
  user_id: string;
  raw_input: string;
  activity_tag: string;
  activity_detail: string;
  window_start: string;
  window_end: string;
  status: MomentStatus;
  created_at: string;
};


/** 资料表单提交给 Server Action 的载荷 */
export type ProfileInput = {
  nickname: string;
  city: string;
  birthday: string;
  avatarUrl: string | null;
};

export const NICKNAME_MAX = 20;

export const CITIES = [
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "成都",
  "重庆",
  "武汉",
  "南京",
  "西安",
  "苏州",
  "长沙",
  "天津",
  "郑州",
  "青岛",
  "厦门",
  "其他",
] as const;
