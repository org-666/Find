"use client";

/**
 * 模块 C + D：找到人 → AI 替双方做第一轮确认 → 去 / 算了
 *
 * 正式版和试玩版最大的区别：对面是真人。
 * 需求写进数据库后，数据库侧的匹配函数会找到另一个"同时段想做同一件事"的人，
 * 双方各自看到**同一句** AI 确认文案，各自点去/算了——两人都点去才会开临时局。
 *
 * 界面全程不出现人：没有头像、没有昵称、没有精确坐标，只有「XX 米内」和时段重叠。
 */

import { useEffect, useState } from "react";
import { respondMatchAction, syncMatchAction, type MatchView } from "@/app/match/actions";
import { Button, Card, Chip, Notice, StatRow } from "@/components/ui";
import type { Moment } from "@/lib/types";

/** 交给临时对话（模块 E）的一局信息 */
export type SessionInfo = {
  sessionId: string;
  activityDetail: string;
  place: string;
  etaMinutes: number;
  distanceLabel: string;
  deadline: number;
};

type Props = {
  moment: Moment;
  onCancel: () => void;
  onEnterChat: (session: SessionInfo) => void;
};

/** 轮询间隔：等对方回应时勤一点，纯找人的时候松一点 */
const POLL_WAITING_MS = 3000;
const POLL_SEARCHING_MS = 5000;

export function MatchPanel({ moment, onCancel, onEnterChat }: Props) {
  const [match, setMatch] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // 轮询：找人在等的人、对方回应了没、局开了没。syncMatchAction 是幂等的，所以放心反复调
  useEffect(() => {
    let alive = true;

    const tick = () => {
      void (async () => {
        const result = await syncMatchAction();
        if (!alive) return;
        if (result.ok) setMatch(result.match);
        else setError(result.message);
      })();
    };

    tick(); // 立刻来一次
    const waiting = match?.myDecision === "go" || (match != null && match.peerDecision !== "pending");
    const timer = setInterval(tick, waiting ? POLL_WAITING_MS : POLL_SEARCHING_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [match?.myDecision, match?.peerDecision]);

  useEffect(() => {
    if (match) return; // 找到人了就停表
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [match]);

  async function respond(decision: "go" | "skip") {
    if (!match) return;
    setBusy(true);
    setError(null);

    try {
      const result = await respondMatchAction(match.matchId, decision);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMatch(result.match);

      // 有人说了算了 → 这一局散了，回到说需求那一步
      if (result.match?.status === "declined") {
        onCancel();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function enterChat() {
    if (!match?.sessionId) return;
    onEnterChat({
      sessionId: match.sessionId,
      activityDetail: match.activityDetail,
      place: match.place ?? "见面点待定",
      etaMinutes: match.etaMinutes ?? 5,
      distanceLabel: match.distanceLabel,
      deadline: match.sessionExpiresAt ? new Date(match.sessionExpiresAt).getTime() : Date.now() + 90 * 60_000,
    });
  }

  /* ------------------------------ 正在找 ------------------------------ */

  // 没配上人 → 继续找
  if (!match) {
    return <SearchingView moment={moment} elapsed={elapsed} error={error} onCancel={onCancel} />;
  }

  // 双方都去 → 开临时局
  if (match.status === "confirmed") {
    return <OpenedView match={match} error={error} onEnterChat={enterChat} onCancel={onCancel} />;
  }

  // 我点了去、对方还没回 → 等
  if (match.myDecision === "go") {
    return <WaitingView match={match} error={error} />;
  }

  return (
    <ProposalView
      match={match}
      busy={busy}
      error={error}
      onGo={() => void respond("go")}
      onSkip={() => void respond("skip")}
    />
  );
}

/* -------------------------------- 搜索中 -------------------------------- */

function SearchingView({
  moment,
  elapsed,
  error,
  onCancel,
}: {
  moment: Moment;
  elapsed: number;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">正在找</h1>
        <p className="text-sm text-ink/55">你不用挑人，系统只把重合的那一刻给你。</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-80" />
            <span className="relative inline-flex size-3 rounded-full bg-coral" />
          </span>
          <p className="text-base font-bold text-ink">正在找附近也想{moment.activity_detail}的人…</p>
        </div>

        <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4">
          <StatRow label="你说的" value={`「${moment.raw_input}」`} />
          <StatRow label="条件" value={`${moment.activity_detail} · 同时段 · 附近 1.5 公里内`} />
          <StatRow label="已找" value={`${elapsed} 秒`} />
        </dl>
      </Card>

      <p className="text-xs leading-relaxed text-ink/50">
        需求已经在池子里了。有人此刻想做同一件事、时间又对得上，这里立刻就会有反应。
      </p>

      {error && <Notice tone="warn">{error}</Notice>}

      <div className="mt-auto">
        <Button type="button" variant="outline" onClick={onCancel}>
          算了，撤回来
        </Button>
      </div>
    </>
  );
}

/* ------------------------------ AI 确认卡 ------------------------------ */

function ProposalView({
  match,
  busy,
  error,
  onGo,
  onSkip,
}: {
  match: MatchView;
  busy: boolean;
  error: string | null;
  onGo: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="pop-hover text-[28px] font-black leading-tight tracking-tight text-ink">
          有人也想做这件事
        </h1>
        <p className="text-sm text-ink/55">AI 已经替你问过对方了，现在就看你答不答应。</p>
      </div>

      <Card className="p-5">
        {match.confirmMessage ? (
          <p className="text-lg font-bold leading-relaxed text-ink">{match.confirmMessage}</p>
        ) : (
          <p className="text-base font-bold text-ink/60">正在和对方对时间地点…</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip tone="coral">{match.distanceLabel}</Chip>
          {match.overlapMinutes !== null && <Chip tone="white">时段重叠 {match.overlapMinutes} 分钟</Chip>}
          <Chip tone="lime">AI 生成</Chip>
        </div>

        <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4">
          <StatRow label="见面点" value={match.place ?? "待定"} />
          <StatRow label="多久到" value={match.etaMinutes ? `${match.etaMinutes} 分钟` : "待定"} />
          <StatRow
            label="对方"
            value={match.peerDecision === "go" ? "已经说去" : match.peerDecision === "skip" ? "说算了" : "还没回"}
          />
        </dl>
      </Card>

      {error && (
        <Notice tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="mt-auto space-y-2.5">
        <Button type="button" loading={busy} onClick={onGo}>
          去
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onSkip}>
          算了
        </Button>
      </div>
    </>
  );
}

/* -------------------------------- 等对方 -------------------------------- */

function WaitingView({ match, error }: { match: MatchView; error: string | null }) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">等你对面那位</h1>
        <p className="text-sm text-ink/55">你点了「去」，现在看对方的意思。</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-80" />
            <span className="relative inline-flex size-3 rounded-full bg-mint" />
          </span>
          <p className="text-base font-bold text-ink">正在等对方确认…</p>
        </div>
        <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4">
          <StatRow label="活动" value={match.activityDetail} />
          <StatRow label="见面点" value={match.place ?? "待定"} />
          <StatRow label="距离" value={match.distanceLabel} />
        </dl>
      </Card>

      {error && <Notice tone="warn">{error}</Notice>}
    </>
  );
}

/* ------------------------------ 双方都去 ------------------------------ */

function OpenedView({
  match,
  error,
  onEnterChat,
  onCancel,
}: {
  match: MatchView;
  error: string | null;
  onEnterChat: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="pop-hover text-[28px] font-black leading-tight tracking-tight text-ink">成了</h1>
        <p className="text-sm text-ink/55">双方都点了「去」，这一局可以开始了。</p>
      </div>

      <Card className="p-5">
        <p className="text-base font-bold text-ink">
          {match.activityDetail} · {match.place ?? "见面点待定"}
        </p>
        <dl className="mt-5 space-y-2.5 border-t border-ink/15 pt-4">
          <StatRow label="多久到" value={match.etaMinutes ? `${match.etaMinutes} 分钟` : "—"} />
          <StatRow label="距离" value={match.distanceLabel} />
          <StatRow label="这一局" value="临时开，做完就散" />
        </dl>
      </Card>

      <Notice tone="info">
        接下来开一个临时对话：只有「我到了 / 我晚点 / 算了」三个按钮，局结束自动关闭、聊天记录会直接删掉。
      </Notice>

      {error && <Notice tone="warn">{error}</Notice>}

      <div className="mt-auto space-y-2.5">
        <Button type="button" onClick={onEnterChat}>
          进临时对话
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          结束这一局
        </Button>
      </div>
    </>
  );
}
