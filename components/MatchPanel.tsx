"use client";

/**
 * 模块 C 的界面：找到人 → AI 替双方做第一轮确认 → 去 / 算了
 *
 * 四个阶段：
 *   searching  正在找附近也想做这件事的人…（带秒数和扫描过程的反馈）
 *   proposal   AI 的确认卡：「有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？」
 *   waiting    你点了去，等对方回应
 *   opened     双方都去 → 临时对话（模块 D/E 待做）
 *
 * 产品原则：全程不出现人。没有头像、没有昵称、没有精确坐标，
 * 只有「XX 米内」和「时段重叠多久」。
 */

import { useEffect, useRef, useState } from "react";
import { respondToProposalAction, searchMatchAction, type MatchView } from "@/app/match/actions";
import type { ConfirmProposal } from "@/lib/ai-confirm";
import { sessionDeadline } from "@/lib/chat";
import { Button, Card, cn, Notice } from "@/components/ui";
import type { Moment } from "@/lib/types";

type Phase = "searching" | "proposal" | "waiting" | "opened";

/** 交给临时对话（模块 E）的一局信息 */
export type SessionInfo = {
  activityDetail: string;
  place: string;
  etaMinutes: number;
  distanceLabel: string;
  /** 开局时间，用来算"已经过了多久" */
  startedAt: number;
  /** 自动关闭的时间点 */
  deadline: number;
};

type Props = {
  moment: Moment;
  isDemo: boolean;
  onCancel: () => void;
  onEnterChat: (session: SessionInfo) => void;
};

export function MatchPanel({ moment, isDemo, onCancel, onEnterChat }: Props) {
  const [phase, setPhase] = useState<Phase>("searching");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [proposal, setProposal] = useState<ConfirmProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [timings, setTimings] = useState<{ searchedMs: number; candidatesScanned: number } | null>(null);

  /**
   * 每次搜索领一个递增的编号，回调里对不上号就把结果丢掉。
   *
   * 为什么不用"已启动本轮"这类 ref 标记：开发模式下 React StrictMode 会把组件
   * 挂载两次（挂载 → 卸载 → 再挂载），卸载时的 cleanup 会把结果标记成作废，
   * 而第二次挂载又被"已启动"标记挡住不发请求，结果就是永远停在"正在找"。
   * 用编号就没有这个死角：新挂载照常发请求，旧请求的结果自然被丢弃。
   */
  const runId = useRef(0);

  // 计时器：让"正在找…"有活着的感觉，而不是一个静止的 loading
  useEffect(() => {
    if (phase !== "searching") return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // 进入匹配池就自动发一次搜索
  useEffect(() => {
    if (phase !== "searching") return;

    const myRun = ++runId.current;
    setElapsed(0);
    setError(null);

    void (async () => {
      try {
        const windowStart = new Date(moment.window_start).getTime();
        const windowEnd = new Date(moment.window_end).getTime();
        const result = await searchMatchAction({
          rawInput: moment.raw_input,
          activityTag: moment.activity_tag,
          activityDetail: moment.activity_detail,
          windowStart: Number.isFinite(windowStart) ? windowStart : Date.now(),
          windowEnd: Number.isFinite(windowEnd) ? windowEnd : Date.now() + 2 * 60 * 60_000,
          mode: isDemo ? "demo" : "live",
        });

        if (runId.current !== myRun) return; // 已经有更新的一轮了，这次结果作废

        if (!result.ok) {
          setError(result.message);
          return;
        }
        setMatch(result.match);
        setProposal(result.proposal);
        setTimings({ searchedMs: result.searchedMs, candidatesScanned: result.candidatesScanned });
        setPhase("proposal");
      } catch (caught) {
        if (runId.current !== myRun) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  }, [phase, round, moment, isDemo]);

  async function respond(decision: "go" | "skip") {
    if (!match) return;
    setBusy(true);
    setError(null);

    try {
      if (decision === "skip") {
        // 任何一方点"算了"就回到匹配池继续找（architecture.md 模块 D）
        setPhase("searching");
        setRound((value) => value + 1);
        setMatch(null);
        setProposal(null);
        return;
      }

      setPhase("waiting");
      const result = await respondToProposalAction({
        matchMomentId: match.momentId,
        decision: "go",
        mode: isDemo ? "demo" : "live",
      });

      if (!result.ok) {
        setError(result.message);
        setPhase("proposal");
        return;
      }
      setPhase("opened");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------- 搜索中 ------------------------------- */

  if (phase === "searching") {
    return (
      <>
        <div className="space-y-2">
          <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">正在找</h1>
          <p className="text-sm text-ink/55">你不用挑人，系统只把重合的那一刻给你。</p>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ink opacity-70" />
              <span className="relative inline-flex size-3 rounded-full bg-ink" />
            </span>
            <p className="text-base font-medium text-ink">正在找附近也想{moment.activity_detail}的人…</p>
          </div>

          <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4 text-sm">
            <Row label="你说的是" value={`「${moment.raw_input}」`} />
            <Row label="条件" value={`${moment.activity_detail} · 同时段 · 附近`} />
            <Row label="已找" value={`${elapsed} 秒${round > 1 ? `（第 ${round} 轮）` : ""}`} />
          </dl>
        </Card>

        {error && <Notice tone="warn">{error}</Notice>}

        <div className="mt-auto space-y-2.5">
          {elapsed >= 5 && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setRound((value) => value + 1)}
            >
              还没找到？再找一次
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onCancel}>
            算了，撤回来
          </Button>
        </div>
      </>
    );
  }

  /* ------------------------------- AI 确认 ------------------------------- */

  if (phase === "proposal" && match && proposal) {
    return (
      <>
        <div className="space-y-2">
          <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">有人也想做这件事</h1>
          <p className="text-sm text-ink/55">AI 已经替你问过对方了，现在就看你答不答应。</p>
        </div>

        {/* AI 发出的确认：这是模块 C 的核心产出 */}
        <Card className="p-5">
          <p className="text-lg font-medium leading-relaxed text-ink">{proposal.message}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip tone="brand">{match.distanceLabel}</Chip>
            <Chip tone="muted">时段重叠 {match.overlapMinutes} 分钟</Chip>
            <Chip tone="muted">{proposal.source === "ai" ? "AI 生成" : "本地模板"}</Chip>
          </div>

          <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4 text-sm">
            <Row label="见面点" value={proposal.place} />
            <Row label="多久到" value={`${proposal.etaMinutes} 分钟`} />
            <Row label="同一时段" value={`还有 ${match.peerCount} 个人想做这件事`} />
          </dl>
        </Card>

        {timings && (
          <p className="text-xs leading-relaxed text-ink/45">
            扫描了 {timings.candidatesScanned} 个候选人，用时 {(timings.searchedMs / 1000).toFixed(1)} 秒
            {proposal.note ? ` · ${proposal.note}` : ""}
          </p>
        )}

        {error && (
          <Notice tone="error" className="animate-shake">
            {error}
          </Notice>
        )}

        <div className="mt-auto space-y-2.5">
          <Button type="button" loading={busy} onClick={() => void respond("go")}>
            去
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void respond("skip")}>
            算了
          </Button>
        </div>

        {isDemo && (
          <p className="text-center text-xs text-ink/45">
            试玩模式：对方是合成的，但你看到的距离、时段重叠、打分排序都是真引擎算出来的
          </p>
        )}
      </>
    );
  }

  /* -------------------------------- 等对方 -------------------------------- */

  if (phase === "waiting") {
    return (
      <>
        <div className="space-y-2">
          <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">等你对面那位</h1>
          <p className="text-sm text-ink/55">你点了「去」，现在看对方的意思。</p>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-70" />
              <span className="relative inline-flex size-3 rounded-full bg-mint" />
            </span>
            <p className="text-base font-medium text-ink">正在等对方确认…</p>
          </div>
          {match && (
            <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4 text-sm">
              <Row label="活动" value={match.activityDetail} />
              <Row label="见面点" value={proposal?.place ?? "—"} />
            </dl>
          )}
        </Card>
      </>
    );
  }

  /* ------------------------------ 双方都去 ------------------------------ */

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">成了</h1>
        <p className="text-sm text-ink/55">双方都点了「去」，这一局可以开始了。</p>
      </div>

      <Card className="p-5">
        <p className="text-base font-medium text-ink">
          {moment.activity_detail} · {proposal?.place ?? "见面点待定"}
        </p>
        <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4 text-sm">
          <Row label="多久到" value={`${proposal?.etaMinutes ?? "—"} 分钟`} />
          <Row label="距离" value={match?.distanceLabel ?? "附近"} />
          <Row label="这一局" value="临时开，做完就散" />
        </dl>
      </Card>

      <Notice tone="info">
        双方都点了「去」，接下来开一个临时对话（只有「我到了 / 我晚点 / 算了」三个按钮），
        局结束会自动关闭、不留记录。
      </Notice>

      <div className="mt-auto space-y-2.5">
        <Button
          type="button"
          onClick={() =>
            onEnterChat({
              activityDetail: moment.activity_detail,
              place: proposal?.place ?? "见面点待定",
              etaMinutes: proposal?.etaMinutes ?? 5,
              distanceLabel: match?.distanceLabel ?? "附近",
              startedAt: Date.now(),
              deadline: sessionDeadline(
                new Date(moment.window_end).getTime(),
                Date.now(),
                isDemo,
              ),
            })
          }
        >
          进临时对话
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          结束这一局
        </Button>
      </div>
    </>
  );
}

/* --------------------------------- 小组件 --------------------------------- */

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "brand" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-full border-2 border-ink px-2.5 py-1 text-xs font-bold",
        tone === "brand"
          ? "border-ink bg-lime/50 text-ink"
          : "border-ink bg-white text-ink/55",
      )}
    >
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-ink/45">{label}</dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  );
}
