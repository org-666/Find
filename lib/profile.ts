/**
 * users 表的数据访问（服务端专用，只能在 Server Component / Server Action 里调用）
 */

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { USERS_TABLE, type ProfileInput, type UserProfile } from "@/lib/types";

export type { UserProfile };

/** 读取某个用户的资料；还没填过就是 null */
export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from(USERS_TABLE).select("*").eq("id", userId).maybeSingle();

  if (error) throw new Error(`读取用户资料失败：${error.message}`);
  return (data as UserProfile | null) ?? null;
}

/** 新建或更新资料（id 就是 auth.users 的 id，一对一） */
export async function upsertProfile(userId: string, input: ProfileInput): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from(USERS_TABLE).upsert(
    {
      id: userId,
      nickname: input.nickname,
      city: input.city,
      birthday: input.birthday,
      avatar_url: input.avatarUrl,
    },
    { onConflict: "id" },
  );

  if (error) {
    // 数据库里的年龄触发器是最后一道防线，把它翻译成用户看得懂的提示
    if (error.message.includes("AGE_OUT_OF_RANGE") || error.code === "23514") {
      throw new Error("AGE_OUT_OF_RANGE");
    }
    throw new Error(`保存资料失败：${error.message}`);
  }
}
