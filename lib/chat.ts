/**
 * 模块 E 的核心：临时对话
 *
 * architecture.md 对这块的约束很硬，全部体现在这个文件里：
 * - 只有 3 个按钮：我到了 / 我晚点 / 算了
 * - AI 在用户不知道说什么时给一句建议，但**绝不替人聊天**（建议要用户自己点"用这句"才进输入框）
 * - 局结束后自动关闭，系统不留记录
 *
 * 这里全是纯函数，所以"什么时候关""建议说什么"这些规则都能被单测覆盖。
 */

export type ChatFrom = "me" | "peer";
export type ChatKind = "text" | "status";

export type ChatMessage = {
  id: string;
  from: ChatFrom;
  /** status 是那三个按钮按出来的状态，text 是人打的话 */
  kind: ChatKind;
  text: string;
  at: number;
};

export const MAX_MESSAGE_LENGTH = 100;

/** 三个快捷按钮 —— 就这三个，不加别的 */
export const QUICK_ACTIONS = [
  { key: "arrived", label: "我到了" },
  { key: "late", label: "我晚点" },
  { key: "cancel", label: "算了" },
] as const;

export type QuickActionKey = (typeof QUICK_ACTIONS)[number]["key"];

export function quickActionLabel(key: QuickActionKey): string {
  return QUICK_ACTIONS.find((action) => action.key === key)?.label ?? key;
}

/* --------------------------------- 输入校验 --------------------------------- */

export function sanitizeMessage(input: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) return { ok: false, message: "说点什么再发" };
  if (value.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, message: `最多 ${MAX_MESSAGE_LENGTH} 个字` };
  }
  return { ok: true, value };
}

/* --------------------------------- 自动关闭 --------------------------------- */

/** 关门前留个提示，避免用户正打字就被关掉 */
export const CLOSING_SOON_MS = 60_000;

export function isSessionExpired(deadline: number, now: number): boolean {
  return now >= deadline;
}

/** 倒计时文案：超过 1 分钟说分钟，最后一分钟说秒 */
export function formatRemaining(deadline: number, now: number): string {
  const left = Math.max(0, deadline - now);
  if (left <= 0) return "已结束";
  if (left < CLOSING_SOON_MS) return `还剩 ${Math.ceil(left / 1000)} 秒`;
  return `还剩 ${Math.ceil(left / 60_000)} 分钟`;
}

export function isClosingSoon(deadline: number, now: number): boolean {
  const left = deadline - now;
  return left > 0 && left <= CLOSING_SOON_MS;
}

/* --------------------------------- AI 建议 --------------------------------- */

export type SuggestContext = {
  activityDetail: string;
  /** 对方最后一句说了什么；还没说过就是 null */
  lastPeerText: string | null;
  /** 已经过去多久（分钟） */
  elapsedMinutes: number;
};

/**
 * 本地兜底建议。
 * 只给"该问什么"的方向，不给可以直接照发的话——AI 不替人聊天。
 */
export function suggestLocally(context: SuggestContext): string {
  const peer = context.lastPeerText ?? "";

  if (!context.lastPeerText) return "问问他到哪了";
  if (/快到了|马上|在路上|出发/.test(peer)) return "说说你在哪个位置等他";
  if (/晚|堵|耽搁|迟到/.test(peer)) return "问问他大概还要多久";
  if (/到了|在哪|没看到/.test(peer)) return "把附近好认的标志物告诉他";
  if (/找不到|怎么走/.test(peer)) return "让他看看场馆入口在哪";
  if (context.elapsedMinutes >= 10) return "问问他是不是还在等";
  return "问问他到哪了";
}

/* --------------------------------- 便捷构造 --------------------------------- */

let counter = 0;

export function makeMessage(from: ChatFrom, kind: ChatKind, text: string, at: number): ChatMessage {
  counter += 1;
  return { id: `${at}-${from}-${counter}`, from, kind, text, at };
}
