"use client";

/**
 * 登录：邮箱验证码
 *
 * 为什么砍掉手机号：手机号登录在云端必须接短信服务商（Twilio 等）才能真发短信，
 * 免费额度有限、发到国内号码还可能被监管限制。邮箱验证码不需要任何付费通道，是更实际的选择。
 *
 * 两条路都能登进来：
 * 1. 邮件里的 6 位验证码 → 填进格子
 * 2. 邮件里的链接 → 走 /auth/confirm 自动登录（换浏览器也能用，见那个文件的注释）
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn, inputBase, Notice, PageHeading } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase";

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

/** Supabase 的错误是英文的，这里翻译成用户看得懂的话 */
function humanizeAuthError(message: string): string {
  const text = message.toLowerCase();

  if (text.includes("not authorized")) {
    return "这个邮箱不在授权名单里：现在用的还是 Supabase 内置邮件服务，它只能发给项目团队成员的邮箱。要发给任意邮箱，需要在 Authentication → Emails → SMTP Settings 里配一个自己的邮件服务（免费的可以选 QQ 邮箱 / 163 / Brevo）";
  }
  if (text.includes("rate limit") || text.includes("security purposes") || text.includes("too many")) {
    return "发送太频繁了：等一分钟再试（免费邮件服务都有频率限制）";
  }
  if (text.includes("email address") && text.includes("invalid")) return "邮箱格式不正确";
  if (text.includes("signups not allowed") || text.includes("signup")) {
    return "这个项目关闭了新用户注册，去 Authentication → Sign In / Providers → Email 里打开";
  }
  if (text.includes("expired")) return "验证码已过期，重新发一封";
  if (text.includes("smtp") || text.includes("sending") || text.includes("mailer")) {
    return "邮件发送失败：Supabase 的 SMTP 配置可能有问题，去 Authentication → Emails 检查一下";
  }
  if (text.includes("token") || text.includes("otp") || text.includes("invalid")) return "验证码不正确";
  return message;
}

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);

  const otpRef = useRef<HTMLInputElement>(null);
  const autoSubmitted = useRef(false);

  const address = email.trim();

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

  function fail(message: string) {
    setError(message);
    setShakeKey((key) => key + 1); // 触发抖动动画
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
          shouldCreateUser: true, // 没注册过就是注册，注册过就是登录
          // 点邮件里的链接后回到自己的回调，由它把会话写进 cookie
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });

      if (sendError) {
        fail(humanizeAuthError(sendError.message));
        return;
      }

      setStep("code");
      setToken("");
      autoSubmitted.current = false;
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

      // 邮件 token 的类型取决于这次是"新用户注册"还是"老用户登录"：
      // 老用户是 email，新用户是 signup。先按 email 试，不匹配再按 signup 试一次。
      // 校验失败不会作废验证码，所以重试是安全的。
      const first = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
      const result =
        first.error && /invalid|expired|token/i.test(first.error.message)
          ? await supabase.auth.verifyOtp({ email: address, token, type: "signup" })
          : first;

      if (result.error) {
        fail(humanizeAuthError(result.error.message));
        autoSubmitted.current = false; // 允许改完再自动提交一次
        return;
      }

      // 会话已经写进 cookie，接下来去填资料（没填过的话）
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
        title={step === "email" ? "注册 / 登录" : "输入验证码"}
        subtitle={step === "email" ? "邮箱收个码就行，没有密码" : `已发送到 ${address}`}
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
          <p className="text-xs leading-relaxed text-ink/50">
            第一次登录就是注册。18-30 岁才能用，下一步填生日时会校验。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 隐形输入框盖在 6 个格子上：既保留原生粘贴/邮件自动填充，又能做分格视觉 */}
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
          {busy ? "处理中…" : step === "email" ? "发送登录邮件" : "登录 / 注册"}
        </Button>
        {step === "email" && (
          <p className="text-center text-xs font-medium text-ink/45">收不到就看一眼垃圾箱</p>
        )}
      </div>
    </div>
  );
}
