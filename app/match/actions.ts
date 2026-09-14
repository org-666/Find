"use server";

/**
 * 模块 C / D 的服务端动作（正式版）
 *
 * 匹配不在 Node 里算，而是交给数据库函数：
 * 用户的 RLS 只允许读自己那一行，所以只有数据库侧的 security definer 函数
 * 才能看到别人的需求——但它**只返回模糊距离和时段重叠，不返回对方身份**。
 *
 * AI 仍然负责第一轮时间地点的确认文案（architecture.md 里 AI 的第二件事）。
 */

import { headers } from "next/headers";
import { buildConfirmProposal } from "@/lib/ai-confirm";
import { createServerSupabaseClient, getCurrentUser } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/rate-limit";

export type Decision = "pending" | "go" | "skip";

/** 给界面看的匹配状态：没有任何对方身份信息 */
export type MatchView = {
  matchId: string;
  activityDetail: string;
  distanceLabel: string;
  overlapMinutes: number | null;
  place: string | null;
  etaMinutes: number | null;
  confirmMessage: string | null;
  myDecision: Decision;
  peerDecision: Decision;
  status: "pending" | "confirmed" | "declined" | "expired";
  sessionId: string | null;
  sessionExpiresAt: string | null;
};

export type MatchResult = { ok: true; match: MatchView | null } | { ok: false; message: string };

type Row = Record<string, unknown>;

function toView(row: Row): MatchView {
  return {
    matchId: String(row.match_id),
    activityDetail: String(row.activity_detail ?? ""),
    distanceLabel: String(row.distance_label ?? "附近"),
    overlapMinutes: row.overlap_minutes === null ? null : Number(row.overlap_minutes),
    place: (row.place as string | null) ?? null,
    etaMinutes: row.eta_minutes === null ? null : Number(row.eta_minutes),
    confirmMessage: (row.confirm_message as string | null) ?? null,
    myDecision: (row.my_decision as Decision) ?? "pending",
    peerDecision: (row.peer_decision as Decision) ?? "pending",
    status: (row.status as MatchView["status"]) ?? "pending",
    sessionId: (row.session_id as string | null) ?? null,
    sessionExpiresAt: (row.session_expires_at as string | null) ?? null,
  };
}

/** 把数据库里的错误码翻译成用户看得懂的话 */
function humanizeDbError(message: string): string {
  if (message.includes("NOT_AUTHENTICATED")) return "登录状态已失效，请重新登录";
  if (message.includes("NO_ACTIVE_MOMENT")) return "你还没有正在找的需求，先说一句想干嘛";
  if (message.includes("NOT_YOUR_MATCH")) return "这一局不是你的";
  if (message.includes("SESSION_NOT_OPEN")) return "这一局已经结束了";
  if (/does not exist|schema cache/i.test(message)) return "数据库还没建好匹配相关的表，请联系管理员";
  return `操作失败：${message}`;
}

/** 读当前这一局（界面用来轮询） */
async function readMyMatch(): Promise<MatchView | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_my_match");
  if (error) throw new Error(humanizeDbError(error.message));

  const rows = (data ?? []) as Row[];
  return rows.length > 0 ? toView(rows[0]) : null;
}

/**
 * 界面每次轮询都调它（第一次进入也调它），一次搞定三件事：
 *   1. 我这一局还在不在
 *   2. 不在就去池子里重新找（request_match 自己会去重，不会重复配对）
 *   3. 配对存在但 AI 还没写确认文案，就补上
 *
 * 幂等，所以可以放心按固定间隔反复调。
 */
export async function syncMatchAction(): Promise<MatchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  const supabase = await createServerSupabaseClient();

  try {
    let match = await readMyMatch();

    if (!match) {
      const headerList = await headers();
      const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const limited = rateLimit(`match:${ip}`, 40, 10 * 60_000);
      if (!limited.ok) return { ok: false, message: `找得太频繁了，${limited.retryAfterSeconds} 秒后再试` };

      const { error } = await supabase.rpc("request_match");
      if (error) return { ok: false, message: humanizeDbError(error.message) };
      match = await readMyMatch();
    }

    // AI 生成第一轮确认文案：两边谁先看到谁写，数据库里"谁先写谁说了算"
    if (match && !match.confirmMessage && match.status === "pending") {
      const proposal = await buildConfirmProposal({
        activityTag: "运动",
        activityDetail: match.activityDetail,
        distanceLabel: match.distanceLabel,
        distanceMeters: null,
        overlapMinutes: match.overlapMinutes ?? 0,
      });

      const { error } = await supabase.rpc("set_match_proposal", {
        p_match_id: match.matchId,
        p_place: proposal.place,
        p_eta_minutes: proposal.etaMinutes,
        p_confirm_message: proposal.message,
      });
      if (error) console.error("[syncMatch] 写入确认文案失败：", error.message);

      match = await readMyMatch();
    }

    return { ok: true, match };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 回应：去 / 算了。双方都去 → 返回的 match 里会带上 sessionId */
export async function respondMatchAction(
  matchId: string,
  decision: "go" | "skip",
): Promise<MatchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" };

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("respond_match", {
      p_match_id: matchId,
      p_decision: decision,
    });
    if (error) return { ok: false, message: humanizeDbError(error.message) };

    return { ok: true, match: await readMyMatch() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
