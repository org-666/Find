"use client";

/**
 * 注册 / 登录表单（同一个组件，用 mode 区分）
 *
 * 两者的技术差别只有一处：`shouldCreateUser`
 *   - 注册：true  —— 邮箱没注册过就建账号
 *   - 登录：false —— 邮箱没注册过时 GoTrue 返回 422「Signups not allowed for otp」，
 *                    所以登录页能准确提示"这个邮箱还没注册过，去注册"
 *
 * 其余流程完全一样：收 6 位验证码 → 填进格子（输满自动提交）→ 建立会话。
 * 邮件里的链接也能直接登录（走 /auth/confirm，不依赖浏览器 cookie）。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, cn, inputBase, Notice, PageHeading } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase";

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

export type AuthMode = "login" | "signup";

const COPY = {
  signup: {
    title: "创建账号",
    subtitle: "邮箱收个码就行，不用设密码",
    action: "发送验证码",
    switchText: "已经注册过了？",
    switchLabel: "去登录",
    switchHref: "/login",
    footnote: "18-30 岁才能使用，下一步填生日时会校验",
  },
  login: {
    title: "登录",
    subtitle: "用你注册时的邮箱收码",
    action: "发送验证码",
    switchText: "还没有账号？",
    switchLabel: "去注册",
    switchHref: "/signup",
    footnote: "没收到就看一眼垃圾箱",
  },
} as const;

/** Supabase 的错误是英文的，这里翻译成用户看得懂的话 */
function humanizeAuthError(message: string, mode: AuthMode): { text: string; toSignup?: boolean } {
  const lower = message.toLowerCase();

  // 登录页专属：这个邮箱根本没注册过
  if (lower.includes("signups not allowed")) {
    return mode === "login"
      ? { text: "这个邮箱还没有注册过。先去创建一个账号吧 →", toSignup: true }
      : { text: "注册通道暂时关闭了，去 Authentication → Sign In / Providers 里检查" };
  }

  if (lower.includes("not authorized")) {
    return {
      text: "这个邮箱不在授权名单里：现在用的还是 Supabase 内置邮件服务，它只能发给项目团队成员的邮箱。要发给任意邮箱，需要在 Authentication → Emails → SMTP Settings 里配一个自己的邮件服务",
    };
  }
  if (lower.includes("rate limit") || lower.includes("security purposes") || lower.includes("too many")) {
    return { text: "发送太频繁了：等一分钟再试（免费邮件服务都有频率限制）" };
  }
  if (lower.includes("email address") && lower.includes("invalid")) {
    return { text: "邮箱格式不正确" };
  }
  if (lower.includes("expired")) {
    return { text: "验证码已过期：每次重新发送都会作废之前那封邮件里的码，请用最新那封里的 6 位数字" };
  }
  if (lower.includes("smtp") || lower.includes("sending") || lower.includes("mailer")) {
    return { text: "邮件发送失败：Supabase 的 SMTP 配置可能有问题，去 Authentication → Emails 检查一下" };
  }
  if (lower.includes("token") || lower.includes("otp") || lower.includes("invalid")) {
    return {
      text: "验证码不对：请用最新那封邮件里的 6 位数字（收到过好几封的话，只有最新那封有效）；输错不会作废，可以直接再试一次",
    };
  }
  return { text: message };
}

export function AuthForm({ mode, initialError }: { mode: AuthMode; initialError?: string | null }) {
  const router = useRouter();
  const copy = COPY[mode];

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<ReactNode>(initialError ?? null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);

  const otpRef = useRef<HTMLInputElement>(null);
  const autoSubmitted = useRef(false);
  /** 上次发码的时间戳，用来在页面被手机回收后重建倒计时 */
  const sentAt = useRef(0);

  const address = email.trim();
  const storageKey = `find-auth-${mode}`;

  /**
   * 手机浏览器会把切到后台的标签页整页卸载（尤其是从邮件 App 切回来的时候）。
   * 一卸载，React 状态就全没了，页面会退回"输入邮箱"那一步——
   * 用户看着明明收到了验证码，却只有一个要填邮箱的框，自然以为"登不上去"。
   *
   * 所以把「进行到哪一步 + 邮箱 + 什么时候发的码」存进 sessionStorage，
   * 重新加载时自动恢复到验证码那一步。
   */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { email?: string; step?: string; sentAt?: number };

      if (typeof saved.email === "string" && saved.email.length > 0) {
        setEmail(saved.email);
      }

      if (saved.step === "code" && typeof saved.email === "string") {
        const elapsed = Math.floor((Date.now() - (saved.sentAt ?? 0)) / 1000);
        setStep("code");
        setCountdown(Math.max(0, RESEND_SECONDS - elapsed));
        setHint(`邮件已发到 ${saved.email}：把里面的 6 位数字填在下面，或者直接点邮件里的链接`);
      }
    } catch {
      // 隐私模式下 sessionStorage 可能不可用，忽略即可
    }
    // 只在挂载时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态变化就写回去
  useEffect(() => {
    try {
      if (address.length === 0) {
        sessionStorage.removeItem(storageKey);
        return;
      }
      sessionStorage.setItem(storageKey, JSON.stringify({ email: address, step, sentAt: sentAt.current }));
    } catch {
      // 同上
    }
  }, [address, step, storageKey]);

  function clearSaved() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // 无所谓
    }
  }

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (step === "code") otpRef.current?.focus();
  }, [step]);

  // 输满 6 位自动提交
  useEffect(() => {
    if (step !== "code" || token.length !== CODE_LENGTH || busy || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void verifyCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, step, busy]);

  function fail(message: ReactNode) {
    setError(message);
    setShakeKey((key) => key + 1);
  }

  async function sendCode() {
    setError(null);
    setHint(null);

    if (!EMAIL.test(address)) {
      fail("请输入正确的邮箱地址");
      return;
    }

    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          // 这一行就是注册和登录的唯一技术差别
          shouldCreateUser: mode === "signup",
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });

      if (sendError) {
        const humanized = humanizeAuthError(sendError.message, mode);
        fail(
          humanized.toSignup ? (
            <>
              {humanized.text.replace("→", "")}
              <Link href="/signup" className="font-bold underline underline-offset-2">
                去注册
              </Link>
            </>
          ) : (
            humanized.text
          ),
        );
        return;
      }

      setStep("code");
      setToken("");
      autoSubmitted.current = false;
      sentAt.current = Date.now();
      setCountdown(RESEND_SECONDS);
      setHint(`邮件已发到 ${address}：把里面的 6 位数字填在下面，或者直接点邮件里的链接`);
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);

    if (!/^\d{6}$/.test(token)) {
      fail(`请输入 ${CODE_LENGTH} 位验证码`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();

      // 邮件 token 的类型：老用户是 email，新注册是 signup。
      // 先按 email 试，不匹配再按 signup 试一次（实测失败不会作废验证码，重试是安全的）。
      const first = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
      const result =
        first.error && /invalid|expired|token/i.test(first.error.message)
          ? await supabase.auth.verifyOtp({ email: address, token, type: "signup" })
          : first;

      if (result.error) {
        fail(humanizeAuthError(result.error.message, mode).text);
        autoSubmitted.current = false;
        return;
      }

      // 会话已经写进 cookie；没填过资料的话首页会自动把你送去 /profile
      clearSaved();
      router.replace("/");
      router.refresh();
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
      autoSubmitted.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise space-y-7">
      <PageHeading
        title={step === "email" ? copy.title : "输入验证码"}
        subtitle={step === "email" ? copy.subtitle : `已发送到 ${address}`}
      />

      {step === "email" ? (
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-bold text-ink">
            邮箱
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void sendCode();
            }}
            className={inputBase}
          />
          <p className="text-xs leading-relaxed text-ink/50">{copy.footnote}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 隐形输入框盖在 6 个格子上：保留系统粘贴/验证码自动填充 */}
          <div className="relative" onClick={() => otpRef.current?.focus()}>
            <input
              ref={otpRef}
              id="token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={token}
              disabled={busy}
              onChange={(event) => {
                setToken(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
                autoSubmitted.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void verifyCode();
              }}
              className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
              aria-label="验证码"
            />
            <div className="pointer-events-none flex gap-2.5">
              {Array.from({ length: CODE_LENGTH }).map((_, index) => {
                const char = token[index] ?? "";
                const isActive = index === Math.min(token.length, CODE_LENGTH - 1) && !char;
                return (
                  <div
                    key={index}
                    className={cn(
                      "grid h-14 flex-1 place-items-center rounded-2xl border-2 text-xl font-black transition duration-150",
                      char
                        ? "border-ink bg-lime/60 text-ink shadow-[3px_3px_0_#111111]"
                        : "border-ink bg-white text-ink/30",
                      isActive && !char && "bg-lime/25",
                    )}
                  >
                    {char || (isActive ? <span className="h-5 w-px animate-pulse bg-ink" /> : "")}
                  </div>
                );
              })}
            </div>
          </div>

          {hint && !error && <p className="text-xs leading-relaxed text-ink/50">{hint}</p>}

          <div className="flex items-center justify-between text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                clearSaved();
                setStep("email");
                setToken("");
                setError(null);
                setHint(null);
              }}
              className="text-ink/55 transition hover:text-ink"
            >
              ← 换个邮箱
            </button>
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={countdown > 0 || busy}
              className="text-ink/55 transition hover:text-ink disabled:opacity-50"
            >
              {countdown > 0 ? `${countdown}s 后可重发` : "重新发送"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <Notice key={shakeKey} tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="space-y-3">
        <Button
          type="button"
          loading={busy}
          onClick={() => (step === "email" ? void sendCode() : void verifyCode())}
        >
          {busy ? "处理中…" : step === "email" ? copy.action : mode === "signup" ? "完成注册" : "登录"}
        </Button>

        <p className="text-center text-xs font-medium text-ink/50">
          {copy.switchText}{" "}
          <Link href={copy.switchHref} className="font-bold text-ink underline underline-offset-2">
            {copy.switchLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
