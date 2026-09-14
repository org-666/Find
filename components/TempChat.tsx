"use client";

/**
 * 模块 E：临时对话（正式版）
 *
 * 和试玩版的区别：对面是真人，消息真的走数据库。
 * 但"不留记录"这条不变——局结束调用 close_session，数据库会把消息**物理删除**。
 *
 * 三条硬约束（architecture.md 模块 E）：
 * 1. 只有 3 个按钮：我到了 / 我晚点 / 算了
 * 2. AI 只在用户不知道说什么时给一句方向提示，**不替人聊天**
 * 3. 局结束自动关闭，不留记录
 */

import { useEffect, useRef, useState } from "react";
import {
  closeSessionAction,
  fetchMessagesAction,
  sendMessageAction,
  suggestReplyAction,
  type ChatMessageView,
} from "@/app/chat/actions";
import {
  MAX_MESSAGE_LENGTH,
  QUICK_ACTIONS,
  formatRemaining,
  isClosingSoon,
  isSessionExpired,
  type QuickActionKey,
} from "@/lib/chat";
import { Button, cn, inputBase, Notice } from "@/components/ui";
import type { SessionInfo } from "@/components/MatchPanel";

/** 消息轮询间隔：临时对话就是要"够快"，2 秒一次 */
const POLL_MS = 2000;

type Props = {
  session: SessionInfo;
  onClose: () => void;
};

export function TempChat({ session, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [suggestion, setSuggestion] = useState<{ text: string; source: "ai" | "local" } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState<null | "done" | "expired">(null);

  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const deadline = session.deadline;

  // 每秒走表：倒计时 + 到点自动关门
  useEffect(() => {
    if (closed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closed]);

  useEffect(() => {
    if (closed) return;
    if (!isSessionExpired(deadline, now)) return;

    setClosed("expired");
    void closeSessionAction(session.sessionId);
  }, [deadline, now, closed, session.sessionId]);

  // 轮询消息（每次拉全量并整体替换，避免增量拼接出错；临时对话的量很小）
  useEffect(() => {
    if (closed) return;
    let alive = true;

    const tick = () => {
      void (async () => {
        const result = await fetchMessagesAction(session.sessionId, null);
        if (!alive) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setMessages(result.messages);
      })();
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.sessionId, closed]);

  // 有新消息就滚到底
  useEffect(() => {
    if (messages.length === lastCount.current) return;
    lastCount.current = messages.length;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const lastPeerText = (() => {
    const peer = messages.filter((m) => !m.mine && m.kind === "text");
    return peer.length > 0 ? peer[peer.length - 1].body : null;
  })();

  async function send(text: string, kind: "text" | "status" = "text") {
    const value = text.trim();
    if (value.length === 0) {
      setError("说点什么再发");
      return;
    }

    setError(null);
    setDraft("");
    const result = await sendMessageAction(session.sessionId, kind, value);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    const refreshed = await fetchMessagesAction(session.sessionId, null);
    if (refreshed.ok) setMessages(refreshed.messages);
  }

  async function handleQuickAction(key: QuickActionKey) {
    const action = QUICK_ACTIONS.find((item) => item.key === key);
    if (!action) return;

    if (key === "cancel") {
      setClosed("done");
      await closeSessionAction(session.sessionId);
      return;
    }

    await send(action.label, "status");
  }

  async function askForSuggestion() {
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestReplyAction({
        activityDetail: session.activityDetail,
        lastPeerText,
        elapsedMinutes: (Date.now() - (deadline - 90 * 60_000)) / 60_000,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuggestion({ text: result.suggestion.text, source: result.suggestion.source });
    } finally {
      setSuggesting(false);
    }
  }

  /* -------------------------------- 已结束 -------------------------------- */

  if (closed) {
    return (
      <>
        <div className="space-y-2">
          <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">
            {closed === "expired" ? "这一局结束了" : "这一局散了"}
          </h1>
          <p className="text-sm text-ink/55">
            {closed === "expired" ? "时间到了，局自动关闭。" : "没事，下次想动的时候再说一句。"}
          </p>
        </div>

        <Notice tone="info">聊天内容已经删掉了，数据库里一条都不剩——这是 Find 的规则：做完即散。</Notice>

        <div className="mt-auto">
          <Button type="button" onClick={onClose}>
            回到首页
          </Button>
        </div>
      </>
    );
  }

  /* -------------------------------- 对话中 -------------------------------- */

  const closingSoon = isClosingSoon(deadline, now);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">
            {session.activityDetail}
          </h1>
          <span
            className={cn(
              "shrink-0 rounded-full border-2 border-ink px-2.5 py-1 text-xs font-bold",
              closingSoon ? "bg-coral text-white" : "bg-white text-ink/55",
            )}
          >
            {formatRemaining(deadline, now)}
          </span>
        </div>
        <p className="text-sm text-ink/55">
          {session.place} · {session.etaMinutes} 分钟后 · {session.distanceLabel}
        </p>
      </div>

      {closingSoon && <Notice tone="warn">这一局马上要结束了，结束之后聊天内容不会保留。</Notice>}

      <div
        ref={listRef}
        className="flex max-h-[46vh] min-h-[180px] flex-col gap-2.5 overflow-y-auto rounded-3xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0_#111111]"
      >
        {messages.length === 0 && (
          <p className="m-auto text-center text-xs leading-relaxed text-ink/45">
            说两句吧。只有三个按钮：我到了 / 我晚点 / 算了
            <br />
            这一局结束就什么都没有了
          </p>
        )}

        {messages.map((message) =>
          message.kind === "status" ? (
            <div key={message.id} className="mx-auto">
              <span className="rounded-full border-2 border-ink/30 bg-lime/50 px-3 py-1 text-xs font-bold text-ink">
                {message.mine ? "你发了" : "对方发了"}：{message.body}
              </span>
            </div>
          ) : (
            <div key={message.id} className={cn("flex", message.mine ? "justify-end" : "justify-start")}>
              <span
                className={cn(
                  "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  message.mine ? "bg-ink text-paper" : "border-2 border-ink bg-white text-ink",
                )}
              >
                {message.body}
              </span>
            </div>
          ),
        )}
      </div>

      {suggestion && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-lemon/40 px-3.5 py-2.5 shadow-[3px_3px_0_#111111]">
          <p className="min-w-0 text-xs leading-relaxed text-ink/70">
            不知道说什么？{suggestion.text}
            <span className="ml-1 text-ink/45">（{suggestion.source === "ai" ? "AI 建议" : "本地建议"}）</span>
          </p>
          <button
            type="button"
            onClick={() => setDraft(suggestion.text.replace(/^(问问他|说说|把|让他)/, "").trim() || suggestion.text)}
            className="shrink-0 rounded-xl border-2 border-ink bg-lime px-2.5 py-1 text-xs font-bold text-ink"
          >
            用这句
          </button>
        </div>
      )}

      {error && (
        <Notice tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="mt-auto space-y-3">
        <div className="flex gap-2">
          <input
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="说点什么…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            className={cn(inputBase, "min-w-0 flex-1 py-2.5 text-sm")}
          />
          <button
            type="button"
            onClick={() => void send(draft)}
            disabled={draft.trim().length === 0}
            className="shrink-0 rounded-2xl border-2 border-ink bg-lime px-4 text-sm font-bold text-ink shadow-[3px_3px_0_#111111] disabled:opacity-40"
          >
            发送
          </button>
        </div>

        {/* 就这三个按钮 */}
        <div className="grid grid-cols-3 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => void handleQuickAction(action.key)}
              className={cn(
                "pop-hover rounded-2xl border-2 border-ink px-3 py-2.5 text-sm font-bold",
                action.key === "cancel" ? "bg-coral text-white" : "bg-white text-ink",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs font-medium text-ink/45">
          <button
            type="button"
            onClick={() => void askForSuggestion()}
            disabled={suggesting}
            className="transition hover:text-ink disabled:opacity-50"
          >
            {suggesting ? "正在想…" : "不知道说什么？给我一句提示"}
          </button>
          <button
            type="button"
            onClick={() => void handleQuickAction("cancel")}
            className="transition hover:text-ink"
          >
            结束这一局
          </button>
        </div>
      </div>
    </>
  );
}
