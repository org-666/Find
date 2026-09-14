/**
 * 公共 UI 组件与样式规范
 *
 * 视觉基调：奶油纸底 + 粗黑描边 + 硬投影 + 荧光撞色（贴纸 / 新粗野）
 * —— 拒绝"通用社交 App"那种玻璃拟态 + 紫靛渐变的安全牌。
 *
 * 这个文件不含 hooks / "use client"，服务端组件和客户端组件都能 import。
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

/** 拼类名的小工具 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------- 基础样式 ---------------------------------- */

/** 贴纸卡片：白底 + 2px 黑边 + 硬投影（投影不发虚，这是关键） */
export const cardBase = "rounded-3xl border-2 border-ink bg-white shadow-[5px_5px_0_#111111]";

/** 悬浮时整块弹起来 */
export const cardPop = "pop-hover hover:shadow-[7px_7px_0_#111111]";

export const inputBase =
  "w-full rounded-2xl border-2 border-ink bg-white px-4 py-3 text-base text-ink " +
  "outline-none transition placeholder:text-ink/35 " +
  "focus:bg-lime/25 focus:shadow-[4px_4px_0_#111111] disabled:opacity-45 disabled:cursor-not-allowed";

export const inputInvalid = "border-coral bg-coral/10 focus:bg-coral/15 focus:shadow-[4px_4px_0_#ff5c5c]";

/* ------------------------------------ 按钮 ------------------------------------ */

type ButtonVariant = "primary" | "ink" | "outline" | "ghost";
type ButtonSize = "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  /** 主行动：荧光绿，整页最跳的一块 */
  primary: "bg-lime text-ink font-bold shadow-[5px_5px_0_#111111] hover:shadow-[7px_7px_0_#111111]",
  /** 次要：纯黑，用来压住画面 */
  ink: "bg-ink text-paper font-bold shadow-[5px_5px_0_#c8f135] hover:shadow-[7px_7px_0_#c8f135]",
  outline: "bg-white text-ink font-semibold shadow-[5px_5px_0_#111111] hover:shadow-[7px_7px_0_#111111]",
  ghost: "bg-transparent text-ink/60 font-medium hover:text-ink hover:bg-ink/[0.06]",
};

const SIZES: Record<ButtonSize, string> = {
  md: "rounded-2xl px-4 py-2.5 text-sm",
  lg: "rounded-2xl px-5 py-4 text-base",
};

export function buttonStyles(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
}): string {
  const { variant = "primary", size = "lg", full = true } = options ?? {};
  return cn(
    "inline-flex items-center justify-center gap-2 border-2 border-ink transition duration-150",
    "pop-hover select-none",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grape/30",
    "disabled:opacity-40 disabled:pointer-events-none",
    VARIANTS[variant],
    SIZES[size],
    full && "w-full",
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-4 animate-spin", className)}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  loading?: boolean;
};

export function Button({
  variant,
  size,
  full,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(buttonStyles({ variant, size, full }), className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/* ------------------------------------ 输入 ------------------------------------ */

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  invalid?: boolean;
};

export function TextField({ id, label, hint, error, invalid, className, ...rest }: TextFieldProps) {
  const showInvalid = invalid || Boolean(error);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-invalid={showInvalid || undefined}
        className={cn(inputBase, showInvalid && inputInvalid, className)}
      />
      {hint && !error && <p className="text-xs leading-relaxed text-ink/50">{hint}</p>}
      {error && <p className="text-xs font-medium leading-relaxed text-coral">{error}</p>}
    </div>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
};

export function TextAreaField({ id, label, hint, error, className, ...rest }: TextAreaFieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-bold text-ink">
        {label}
      </label>
      <textarea id={id} {...rest} className={cn(inputBase, "resize-none", error && inputInvalid, className)} />
      {hint && !error && <p className="text-xs leading-relaxed text-ink/50">{hint}</p>}
      {error && <p className="text-xs font-medium leading-relaxed text-coral">{error}</p>}
    </div>
  );
}

/* ------------------------------------ 容器 ------------------------------------ */

export function Card({
  className,
  children,
  pop = false,
}: {
  className?: string;
  children: ReactNode;
  pop?: boolean;
}) {
  return <div className={cn(cardBase, pop && cardPop, className)}>{children}</div>;
}

export function Notice({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "info" | "warn" | "success";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    error: "bg-coral/15 border-coral",
    warn: "bg-lemon/30 border-ink",
    info: "bg-sky/20 border-ink",
    success: "bg-mint/20 border-mint",
  } as const;

  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn("rounded-2xl border-2 px-4 py-3 text-sm leading-relaxed text-ink", tones[tone], className)}
    >
      {children}
    </div>
  );
}

/** 贴纸标签：小、歪一点、撞色——画面里的"活力"颗粒 */
export function Chip({
  children,
  tone = "ink",
  className,
}: {
  children: ReactNode;
  tone?: "ink" | "lime" | "coral" | "sky" | "lemon" | "mint" | "white";
  className?: string;
}) {
  const tones = {
    ink: "bg-ink text-paper border-ink",
    white: "bg-white text-ink border-ink",
    lime: "bg-lime text-ink border-ink",
    coral: "bg-coral text-white border-ink",
    sky: "bg-sky text-ink border-ink",
    lemon: "bg-lemon text-ink border-ink",
    mint: "bg-mint text-ink border-ink",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border-2 px-2.5 py-1 text-xs font-bold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 页面标题区，统一字号与间距 */
export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-[30px] font-black leading-[1.1] tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="text-sm font-medium text-ink/55">{subtitle}</p>}
    </div>
  );
}

/** 一行"标签 + 值"，贴纸风 */
export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-sm text-ink/50">{label}</dt>
      <dd className="truncate text-right text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
