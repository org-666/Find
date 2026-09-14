"use server";

import { headers } from "next/headers";
import { parseIntent, isAiConfigured } from "@/lib/ai-parse";
import { normalizeIntent, validateRawInput, type IntentResult, type IntentSource } from "@/lib/intent";
import { MomentDbError, cancelMoment, insertMoment } from "@/lib/moments";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase-server";
import type { Moment } from "@/lib/types";

export type ParseActionResult =
  | { ok: true; intent: IntentResult; source: IntentSource; model: string | null; note?: string }
  | { ok: false; message: string };

/** 未登录也能试解析的次数上限：10 分钟内 12 次 */
const GUEST_PARSE_LIMIT = 12;
const GUEST_PARSE_WINDOW_MS = 10 * 60_000;

/**
 * 第一步：把用户那句模糊的话交给 AI（没 key 就本地规则）解析。
 *
 * 这一步**不要求登录**：它只是把一句话翻译成标签，不写库、不碰任何用户数据，
 * 让没注册的人先感受一下"说一句就有反应"，再决定要不要注册。
 * 真正需要登录的是下一步——把需求写进匹配池。
 */
export async function parseIntentAction(rawInput: string): Promise<ParseActionResult> {
  const validated = validateRawInput(rawInput);
  if (!validated.ok) return { ok: false, message: validated.message };

  // 开放给未登录用户，就得防着被刷（配了 AI key 的话每次调用都是钱）。
  // 读登录态本身失败（比如环境变量没配）也要当成未登录，不能让试玩路径挂掉。
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limited = rateLimit(`parse:${ip}`, GUEST_PARSE_LIMIT, GUEST_PARSE_WINDOW_MS);
    if (!limited.ok) {
      return { ok: false, message: `试得有点快，${limited.retryAfterSeconds} 秒后再来` };
    }
  }

  const parsed = await parseIntent(validated.value);
  return {
    ok: true,
    intent: parsed.intent,
    source: parsed.source,
    model: parsed.model,
    note: parsed.note,
  };
}

export type PublishActionResult = { ok: true; moment: Moment } | { ok: false; message: string };

/** 第三步：用户点了「对，就这个」，才真正进入匹配池 */
export async function publishMomentAction(payload: {
  rawInput: string;
  intent: IntentResult;
}): Promise<PublishActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  const validated = validateRawInput(payload.rawInput);
  if (!validated.ok) return { ok: false, message: validated.message };

  // 不信任前端传来的 intent：过一遍归一化，模型/前端都改不了分类集合
  const intent = normalizeIntent(payload.intent, validated.value);

  try {
    return { ok: true, moment: await insertMoment(user.id, validated.value, intent) };
  } catch (error) {
    if (error instanceof MomentDbError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export type CancelActionResult = { ok: true } | { ok: false; message: string };

/** 撤回需求 */
export async function cancelMomentAction(momentId: string): Promise<CancelActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  try {
    await cancelMoment(user.id, momentId);
    return { ok: true };
  } catch (error) {
    if (error instanceof MomentDbError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 界面用来显示"当前是 AI 解析还是本地规则" */
export async function aiStatusAction(): Promise<{ ai: boolean }> {
  return { ai: isAiConfigured() };
}
