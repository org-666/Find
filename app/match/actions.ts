"use server";

import { buildConfirmProposal, type ConfirmProposal } from "@/lib/ai-confirm";
import type { CandidateMoment, MatchResult } from "@/lib/matching";
import { findMatches } from "@/lib/matching";
import { DEMO_GRID, DEMO_USER_ID, syntheticCandidates } from "@/lib/matching-demo";
import { rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

/** 界面上拿到的匹配结果：只有模糊信息，没有身份 */
export type MatchView = {
  momentId: string;
  activityTag: string;
  activityDetail: string;
  distanceLabel: string;
  overlapMinutes: number;
  score: number;
  reasons: string[];
  /** 这条候选有多少人（原型阶段就是 1，模块 D/E 会用上） */
  peerCount: number;
};

export type SearchResult =
  | { ok: true; match: MatchView; proposal: ConfirmProposal; searchedMs: number; candidatesScanned: number }
  | { ok: false; message: string };

export type RespondResult =
  | { ok: true; peerDecision: "go" | "skip"; message: string }
  | { ok: false; message: string };

/** 试玩模式：把一条需求当成候选人池的种子 */
function toCandidateMoment(input: {
  rawInput: string;
  activityTag: string;
  activityDetail: string;
  windowStart: number;
  windowEnd: number;
  grid?: string | null | undefined;
}): CandidateMoment {
  return {
    momentId: "demo-self",
    userId: DEMO_USER_ID,
    nickname: "我",
    activityTag: input.activityTag,
    activityDetail: input.activityDetail,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    grid: input.grid ?? DEMO_GRID,
  };
}

/**
 * 发起一次匹配搜索。
 *
 * 试玩模式（免登录）：候选人由 lib/matching-demo.ts 合成，
 * 但筛选、算距离、按时段重叠、打分排序走的都是 lib/matching.ts 里那套真引擎。
 *
 * 登录版（模块 C 的后半段）会把这里换成从 moments 表里查真实候选人，
 * 引擎和 AI 那一步都不用改。
 */
export async function searchMatchAction(input: {
  rawInput: string;
  activityTag: string;
  activityDetail: string;
  windowStart: number;
  windowEnd: number;
  grid?: string | null;
  mode?: "demo" | "live";
}): Promise<SearchResult> {
  // 试玩也要限流：这一步会调 AI，配了 key 就是真花钱
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimit(`match:${ip}`, 20, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, message: `找得太频繁了，${limited.retryAfterSeconds} 秒后再试` };
  }

  const startedAt = Date.now();
  const me = toCandidateMoment(input);

  // 试玩模式：故意等一会儿，模拟"系统在附近找人"的过程
  if ((input.mode ?? "demo") === "demo") {
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  const pool = syntheticCandidates(me, startedAt);
  const matches: MatchResult[] = findMatches(me, pool, { maxDistanceMeters: 1500, minOverlapMinutes: 15 });

  if (matches.length === 0) {
    return { ok: false, message: "附近这会儿还没有人也想做这件事，过一会儿再试" };
  }

  const best = matches[0];
  const proposal = await buildConfirmProposal({
    activityTag: best.activityTag,
    activityDetail: best.activityDetail,
    distanceLabel: best.distanceLabel,
    distanceMeters: best.distanceMeters,
    overlapMinutes: best.overlapMinutes,
  });

  return {
    ok: true,
    match: {
      momentId: best.momentId,
      activityTag: best.activityTag,
      activityDetail: best.activityDetail,
      distanceLabel: best.distanceLabel,
      overlapMinutes: best.overlapMinutes,
      score: best.score,
      reasons: best.reasons,
      peerCount: matches.length,
    },
    proposal,
    searchedMs: Date.now() - startedAt,
    candidatesScanned: pool.length,
  };
}

/**
 * 回应 AI 的第一轮确认：去 / 算了。
 *
 * 试玩模式：对方也立刻"去"，好让流程走完；
 * 登录版这里会写 matches 表并等对方真实回应（模块 D）。
 */
export async function respondToProposalAction(input: {
  matchMomentId: string;
  decision: "go" | "skip";
  mode?: "demo" | "live";
}): Promise<RespondResult> {
  if (input.decision === "skip") {
    return { ok: true, peerDecision: "skip", message: "好，回到匹配池继续找" };
  }

  if ((input.mode ?? "demo") === "demo") {
    await new Promise((resolve) => setTimeout(resolve, 1400));
    return { ok: true, peerDecision: "go", message: "对方也点了「去」" };
  }

  return { ok: false, message: "登录版还没接通，先用试玩模式" };
}
