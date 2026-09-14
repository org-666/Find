/**
 * moments 表的数据访问（服务端专用）
 *
 * 这里额外做一件事：把"数据库还没准备好"这种情况翻译成人话。
 * 因为本地 Supabase 一时半会儿起不来时，用户看到的应该是一句可执行的提示，
 * 而不是 PostgREST 的英文报错。
 */

import type { IntentResult } from "@/lib/intent";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { MOMENTS_TABLE, type Moment, type MomentStatus } from "@/lib/types";

export class MomentDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MomentDbError";
  }
}

/** 表不存在 / 连不上数据库，都归成一句能照着做的提示 */
function humanizeDbError(message: string, code?: string): string {
  if (code === "42P01" || message.includes("does not exist")) {
    return "数据库里还没有 moments 表：请先执行 supabase/migrations/20260914000200_module_b_moments.sql";
  }
  if (code === "42P17" || message.includes("infinite recursion")) {
    return "moments 的 RLS 策略有问题，请重新执行建表 SQL";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return "连不上数据库：本地 Supabase 没起（npm run db:start），或者 .env.local 里的地址不对";
  }
  return `数据库操作失败：${message}`;
}

/** 当前用户正在匹配池里的那条需求（没有就是 null） */
export async function fetchSearchingMoment(userId: string): Promise<Moment | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from(MOMENTS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("status", "searching")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new MomentDbError(humanizeDbError(error.message, error.code));
  return (data as Moment | null) ?? null;
}

/** 确认无误后，把需求丢进匹配池 */
export async function insertMoment(userId: string, rawInput: string, intent: IntentResult): Promise<Moment> {
  const supabase = await createServerSupabaseClient();

  const start = new Date();
  const end = new Date(start.getTime() + intent.timeWindowMinutes * 60_000);

  const { data, error } = await supabase
    .from(MOMENTS_TABLE)
    .insert({
      user_id: userId,
      raw_input: rawInput,
      activity_tag: intent.activityTag,
      activity_detail: intent.activityDetail,
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      status: "searching" satisfies MomentStatus,
    })
    .select("*")
    .single();

  if (error) throw new MomentDbError(humanizeDbError(error.message, error.code));
  return data as Moment;
}

/** 撤回需求：把状态改成 cancelled，不物理删除（模块 C 的匹配需要看到"对方撤了"） */
export async function cancelMoment(userId: string, momentId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from(MOMENTS_TABLE)
    .update({ status: "cancelled" satisfies MomentStatus })
    .eq("id", momentId)
    .eq("user_id", userId);

  if (error) throw new MomentDbError(humanizeDbError(error.message, error.code));
}
