import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * 邮件登录的回调地址（/auth/confirm）
 *
 * Supabase 的邮件里默认只有一条链接，点下去 Supabase 先验证 token，
 * 再把浏览器重定向回站点，并带上：
 *   - ?code=xxx                        （PKCE 流程，需要在这里换成会话）
 *   - ?token_hash=xxx&type=email       （如果在邮件模板里用了 {{ .TokenHash }}）
 * 两种都接住，用户点链接就自动登录，不用再回登录页。
 *
 * Route Handler 里可以写 cookie（Server Component 不行），
 * 所以会话 cookie 是在这里落下的。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createServerSupabaseClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[auth/confirm] exchangeCodeForSession 失败：", error.message);
  } else if (tokenHash) {
    /**
     * token_hash 这条路不依赖浏览器里的 PKCE cookie，
     * 所以在手机 / 别的浏览器里点链接也能登录成功，比 code 那条稳。
     *
     * token 的类型可能是 email（老用户）或 signup（新用户注册），
     * 邮件模板里一般写死 type=email，所以这里不匹配就换个类型再试一次。
     * 校验失败不会作废验证码，重试是安全的。
     */
    const primary = (type ?? "email") as EmailOtpType;
    const attempts: EmailOtpType[] = primary === "email" ? ["email", "signup"] : [primary, "email"];

    for (const attempt of attempts) {
      const { error } = await supabase.auth.verifyOtp({ type: attempt, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(`${origin}${next}`);
      console.error(`[auth/confirm] verifyOtp(${attempt}) 失败：`, error.message);
    }
  }

  // 链接过期 / 已经点过一次 / 在别的浏览器点过，都回到登录页重新来
  return NextResponse.redirect(`${origin}/login?error=link`);
}
