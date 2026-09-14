"use client";

/**
 * 模块 E：临时对话
 *
 * 三条硬约束（architecture.md 模块 E）：
 * 1. 只有 3 个按钮：我到了 / 我晚点 / 算了 —— 界面里没有第 4 个快捷动作
 * 2. AI 只在用户不知道说什么时给一句建议，**不替人聊天**：
 *    建议要用户自己点「用这句」才填进输入框，发不发仍由人决定
 * 3. 局结束自动关闭，不留记录：消息只活在这个组件的内存里，
 *    关闭时整份记录直接丢掉，没有任何地方存着它
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { closeSessionAction, demoPeerReplyAction, suggestReplyAction } from "@/app/chat/actions";
import {
  MAX_MESSAGE_LENGTH,
  QUICK_ACTIONS,
  formatRemaining,
  isClosingSoon,
  isSessionExpired,
  makeMessage,
  sanitizeMessage,
  type ChatMessage,
  type QuickActionKey,
} from "@/lib/chat";
import { Button, cn, inputBase, Notice } from "@/components/ui";
import type { SessionInfo } from "@/components/MatchPanel";

type Props = {
  session: SessionInfo;
  isDemo: boolean;
  onClose: () => void;
};

export function TempChat({ session, isDemo, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [suggestion, setSuggestion] = useState<{ text: string; source: "ai" | "local" } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState<null | "cancelled" | "expired" | "done">(null);

  const listRef = useRef<HTMLDivElement>(null);
  const peerSeen = useRef(0);

  const deadline = session.deadline;

  // 每秒走一次表：倒计时、到期自动关门都靠它
  useEffect(() => {
    if (closed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closed]);

  // 到期自动关闭：这就是模块 E 的"局结束自动关闭"
  useEffect(() => {
    if (closed) return;
    if (!isSessionExpired(deadline, now)) return;

    setClosed("expired");
    setMessages([]); // 不留记录
    setSuggestion(null);
    void closeSessionAction("expired");
  }, [deadline, now, closed]);

  // 新消息进来时滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, peerTyping]);

  const lastPeerText = useMemo(() => {
    const peerMessages = messages.filter((message) => message.from === "peer" && message.kind === "text");
    return peerMessages.length > 0 ? peerMessages[peerMessages.length - 1].text : null;
  }, [messages]);

  function push(message: ChatMessage) {
    setMessages((previous) => [...previous, message]);
  }

  async function askPeer(myMessage: string) {
    setPeerTyping(true);
    try {
      const result = await demoPeerReplyAction({ myMessage, seed: messages.length });
      if (!result.ok) return;
      peerSeen.current += 1;
      push(makeMessage("peer", result.kind, result.reply, Date.now()));
    } catch {
      // 对方没回上不该打断用户，静默跳过
    } finally {
      setPeerTyping(false);
    }
  }

  async function send(text: string, kind: "text" | "status" = "text") {
    setError(null);

    const validated = sanitizeMessage(text);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }

    push(makeMessage("me", kind, validated.value, Date.now()));
    setDraft("");
    setSuggestion(null);

    if (isDemo) void askPeer(validated.value);
  }

  async function handleQuickAction(key: QuickActionKey) {
    const action = QUICK_ACTIONS.find((item) => item.key === key);
    if (!action) return;

    if (key === "cancel") {
      // 「算了」= 不去了，这一局直接结束
      setClosed("cancelled");
      setMessages([]);
      void closeSessionAction("cancelled");
      return;
    }

    await send(action.label, "status");
  }

  async function askForSuggestion() {
    setSuggesting(true);
    setError(null);
    try {
      const elapsedMinutes = (Date.now() - session.startedAt) / 60_000;
      const result = await suggestReplyAction({
        activityDetail: session.activityDetail,
        lastPeerText,
        elapsedMinutes,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuggestion({ text: result.suggestion.text, source: result.suggestion.source });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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
            {closed === "cancelled" ? "这一局取消了" : "这一局结束了"}
          </h1>
          <p className="text-sm text-ink/55">
            {closed === "cancelled" ? "没事，下次想动的时候再说一句。" : "时间到了，局自动关闭。"}
          </p>
        </div>

        <Notice tone="info">
          聊天内容已经清掉了，系统没有留任何记录——这是 Find 的规则：做完即散。
        </Notice>

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
              closingSoon
                ? "border-ink bg-coral text-white"
                : "border-ink bg-white text-ink/55",
            )}
          >
            {formatRemaining(deadline, now)}
          </span>
        </div>
        <p className="text-sm text-ink/55">
          {session.place} · {session.etaMinutes} 分钟后 · {session.distanceLabel}
        </p>
      </div>

      {closingSoon && (
        <Notice tone="warn">这一局马上要结束了，结束之后聊天内容不会保留。</Notice>
      )}

      {/* 消息区 */}
      <div
        ref={listRef}
        className="flex max-h-[46vh] min-h-[180px] flex-col gap-2.5 overflow-y-auto rounded-3xl border-2 border-ink bg-white p-4 shadow-[4px_4px_0_#111111]"
      >
        {messages.length === 0 && !peerTyping && (
          <p className="m-auto text-center text-xs leading-relaxed text-ink/45">
            说两句吧。只有三个按钮：我到了 / 我晚点 / 算了
            <br />
            这一局结束就什么都没有了
          </p>
        )}

        {messages.map((message) =>
          message.kind === "status" ? (
            <div key={message.id} className="mx-auto">
              <span className="rounded-full border-2 border-ink/30 bg-lime/50 px-3 py-1 text-xs text-ink">
                {message.from === "me" ? "你发了" : "对方发了"}：{message.text}
              </span>
            </div>
          ) : (
            <div
              key={message.id}
              className={cn("flex", message.from === "me" ? "justify-end" : "justify-start")}
            >
              <span
                className={cn(
                  "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  message.from === "me"
                    ? "bg-ink text-paper"
                    : "border-2 border-ink bg-white text-ink",
                )}
              >
                {message.text}
              </span>
            </div>
          ),
        )}

        {peerTyping && (
          <div className="flex justify-start">
            <span className="rounded-2xl border-2 border-ink bg-lemon/40 px-3.5 py-2.5 shadow-[3px_3px_0_#111111] text-sm text-ink/45">
              对方在打字…
            </span>
          </div>
        )}
      </div>

      {/* AI 建议：只给方向，用户自己决定用不用 */}
      {suggestion && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-lemon/40 px-3.5 py-2.5 shadow-[3px_3px_0_#111111]">
          <p className="min-w-0 text-xs leading-relaxed text-ink/55">
            不知道说什么？{suggestion.text}
            <span className="ml-1 text-ink/45">
              （{suggestion.source === "ai" ? "AI 建议" : "本地建议"}）
            </span>
          </p>
          <button
            type="button"
            onClick={() => setDraft(suggestion.text.replace(/^(问问他|说说|把|让他)/, "").trim() || suggestion.text)}
            className="shrink-0 rounded-xl border-2 border-ink bg-lime/50 px-2.5 py-1 text-xs text-ink"
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

      {/* 输入区 */}
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
            className="shrink-0 rounded-2xl bg-gradient-to-r from-ink to-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-40"
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
                "rounded-2xl border px-3 py-2.5 text-sm transition",
                action.key === "cancel"
                  ? "border-coral bg-coral/15 text-coral hover:bg-coral/20"
                  : "border-ink bg-white text-ink hover:bg-white",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-ink/45">
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
            onClick={() => {
              setClosed("done");
              setMessages([]);
              void closeSessionAction("done");
            }}
            className="transition hover:text-ink"
          >
            结束这一局
          </button>
        </div>

        {isDemo && (
          <p className="text-center text-xs text-ink/45">
            试玩模式：对方是合成的，回复也是脚本；但「不留记录」是真的——消息只在这个页面的内存里，
            结束就没了
          </p>
        )}
      </div>
    </>
  );
}
