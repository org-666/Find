"use server";

/**
 * 模块 E 的服务端动作
 *
 * 试玩模式（免登录）里，对方是合成的，但走的是同一套动作接口：
 * 以后接上真实用户，把这里的合成逻辑换成读写 sessions/messages 表即可，界面不用改。
 *
 * 「不留记录」这条：试玩模式的消息只活在浏览器内存里，服务端一个字都不存。
 * 真实版本对应的是局结束后物理删除消息行（模块 D/E 的后半段）。
 */

import { buildSuggestion, type Suggestion } from "@/lib/ai-suggest";
import { rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

export type SuggestResult = { ok: true; suggestion: Suggestion } | { ok: false; message: string };

export type PeerReplyResult =
  | { ok: true; reply: string; kind: "text" | "status" }
  | { ok: false; message: string };

/* --------------------------------- AI 建议 --------------------------------- */

export async function suggestReplyAction(context: {
  activityDetail: string;
  lastPeerText: string | null;
  elapsedMinutes: number;
}): Promise<SuggestResult> {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimit(`suggest:${ip}`, 30, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, message: `点得有点频繁，${limited.retryAfterSeconds} 秒后再试` };
  }

  const suggestion = await buildSuggestion({
    activityDetail: context.activityDetail,
    lastPeerText: context.lastPeerText,
    elapsedMinutes: Math.max(0, Math.round(context.elapsedMinutes)),
  });

  return { ok: true, suggestion };
}

/* -------------------------------- 对方回复 -------------------------------- */

/** 合成对方的回应：按"我这句说了什么"给一个合理反应 */
function pickPeerReply(mine: string, seed: number): { reply: string; kind: "text" | "status" } {
  const text = mine;

  if (text.includes("我到了")) return { reply: "我也快到了，等我两分钟", kind: "text" };
  if (text.includes("我晚点")) return { reply: "行，那我先到附近逛逛", kind: "text" };
  if (/在哪|哪等|位置|标志/.test(text)) return { reply: "我在入口那棵大树下面", kind: "text" };
  if (/到哪|多久|还要/.test(text)) return { reply: "还有 5 分钟左右", kind: "text" };
  if (/入口|门口|大树|地铁/.test(text)) return { reply: "看到了看到了", kind: "text" };
  if (/谢谢|好的|行|ok/i.test(text)) return { reply: "嗯嗯", kind: "text" };

  const generics = [
    "我这边也差不多了",
    "刚出门，稍等",
    "你先到了跟我说一声",
    "好，待会儿见",
  ];
  return { reply: generics[seed % generics.length], kind: "text" };
}

export async function demoPeerReplyAction(input: {
  myMessage: string;
  seed: number;
}): Promise<PeerReplyResult> {
  if (!input.myMessage.trim()) return { ok: false, message: "空消息" };

  // 故意慢一点，让它看起来像对面真的在打字
  await new Promise((resolve) => setTimeout(resolve, 1200 + (input.seed % 3) * 400));

  return { ok: true, ...pickPeerReply(input.myMessage, Math.abs(input.seed)) };
}

/* -------------------------------- 结束这一局 -------------------------------- */

export type CloseResult = { ok: true; closedAt: number } | { ok: false; message: string };

export async function closeSessionAction(reason: "cancelled" | "expired" | "done"): Promise<CloseResult> {
  // 试玩模式：服务端本来就没存任何东西，这里只是把"结束"这件事走一遍流程。
  // 真实版本：把 sessions.status 置为 closed，并物理删除该局的 messages 行（不留记录）。
  console.log(`[closeSession] 结束这一局，原因：${reason}（试玩模式，无数据需要清理）`);
  return { ok: true, closedAt: Date.now() };
}
