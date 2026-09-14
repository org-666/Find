import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase";

/** 只有登录后才能访问的路径前缀 */
const PROTECTED_PREFIXES = ["/profile"];

/**
 * middleware 在每次请求前跑一遍，做两件事：
 * 1. 用 @supabase/ssr 刷新可能过期的 access token，并把新 cookie 写回响应
 *    （Server Component 自己不能写 cookie，所以这个活儿必须放在这里）
 * 2. 未登录访问受保护页面时，直接重定向到 /login
 */
export async function middleware(request: NextRequest) {
  // 还没配 Supabase 时放行，让页面自己去显示「请先配置环境变量」的提示
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // 必须调用 getUser()：它顺带完成 token 刷新
  let user = null;
  try {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    user = currentUser;
  } catch (error) {
    // Supabase 不可达时不要让整个站点 500，放行给页面自己处理
    console.error("[middleware] 读取会话失败：", error);
    return NextResponse.next({ request });
  }

  const { pathname } = request.nextUrl;

  /**
   * 邮件登录的兜底：
   * Supabase 把用户从邮件链接带回来时，落地路径取决于后台的 Redirect URLs 配置。
   * 配了 /auth/confirm 就落在那里；没配就会落回站点根路径，并带上 ?code=xxx。
   * 这里统一把带 code 的请求转交给 /auth/confirm 去换会话，
   * 这样不管后台怎么配，点邮件里的链接都能登录成功。
   */
  const code = request.nextUrl.searchParams.get("code");
  if (code && pathname !== "/auth/confirm") {
    const confirmUrl = request.nextUrl.clone();
    confirmUrl.pathname = "/auth/confirm";
    confirmUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(confirmUrl);
  }

  if (!user && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // 已登录就别再看登录页/注册页了
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
