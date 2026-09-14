"use server";

/**
 * 模块 E 的服务端动作（正式版）
 *
 * 消息存在 session_messages 表里，但**局结束就物理删除**——这是"不留记录"的落地方式。
 * 所有读写都走数据库函数，客户端永远拿不到对方是谁。
 */

import { headers } from "next/headers";
import { buildSuggestion, type Suggestion } from "@/lib/ai-suggest";
import { rateLimit } from "@/lib/rate-limit";
import { createServerSupabaseClient, getCurrentUser } from "@/lib/supabase-server";

export type ChatMessageView = {
  id: string;
  mine: boolean;
  kind: "text" | "status";
  body: string;
  createdAt: string;
};

export type MessagesResult = { ok: true; messages: ChatMessageView[] } | { ok: false; message: string };
export type SendResult = { ok: true } | { ok: false; message: string };
export type SuggestResult = { ok: true; suggestion: Suggestion } | { ok: false; message: string };

function humanize(message: string): string {
  if (message.includes("NOT_AUTHENTICATED")) return "登录状态已失效，请重新登录";
  if (message.includes("SESSION_NOT_OPEN")) return "这一局已经结束了";
  if (message.includes("NOT_YOUR_SESSION")) return "这一局不是你的";
  if (/does not exist|schema cache/i.test(message)) return "数据库还没建好会话相关的表";
  return `操作失败：${message}`;
}

/** 读消息。p_since 传上次读到的时间，就只拿增量 */
export async function fetchMessagesAction(
  sessionId: string,
  sinceIso: string | null,
): Promise<MessagesResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_session_messages", {
      p_session_id: sessionId,
      p_since: sinceIso,
    });
    if (error) return { ok: false, message: humanize(error.message) };

    const messages = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      mine: Boolean(row.mine),
      kind: (row.kind as "text" | "status") ?? "text",
      body: String(row.body),
      createdAt: String(row.created_at),
    }));

    return { ok: true, messages };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 发一条消息（三种快捷按钮走 kind="status"） */
export async function sendMessageAction(
  sessionId: string,
  kind: "text" | "status",
  body: string,
): Promise<SendResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  const text = body.trim();
  if (text.length === 0) return { ok: false, message: "说点什么再发" };
  if (text.length > 100) return { ok: false, message: "最多 100 个字" };

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("send_session_message", {
      p_session_id: sessionId,
      p_kind: kind,
      p_body: text,
    });
    if (error) return { ok: false, message: humanize(error.message) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 结束这一局：数据库里会把消息**物理删除** */
export async function closeSessionAction(sessionId: string): Promise<SendResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("close_session", { p_session_id: sessionId });
    if (error) return { ok: false, message: humanize(error.message) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** AI 给一句"该问什么"的提示（不替人聊天） */
export async function suggestReplyAction(context: {
  activityDetail: string;
  lastPeerText: string | null;
  elapsedMinutes: number;
}): Promise<SuggestResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimit(`suggest:${ip}`, 30, 10 * 60_000);
  if (!limited.ok) return { ok: false, message: `点得有点频繁，${limited.retryAfterSeconds} 秒后再试` };

  const suggestion = await buildSuggestion({
    activityDetail: context.activityDetail,
    lastPeerText: context.lastPeerText,
    elapsedMinutes: Math.max(0, Math.round(context.elapsedMinutes)),
  });

  return { ok: true, suggestion };
}
