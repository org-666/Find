import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { fetchWithTimeout, getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase";

/** 只有登录后才能访问的路径前缀 */
const PROTECTED_PREFIXES = ["/profile"];

/**
 * 不需要登录态的页面。
 *
 * 为什么要单独列出来：middleware 里那次 getUser() 是一次跨太平洋请求
 * （数据库在美西）。登录页和注册页本来就与登录态无关，却要等它回来才能渲染，
 * 用户看到的就是"打开注册页一直在转圈"。直接放行，这两个页面就变成零网络请求。
 */
const PUBLIC_AUTH_PAGES = ["/login", "/signup"];

/**
 * middleware 在每次请求前跑一遍，做三件事：
 * 1. 把带 ?code= 的请求转交给 /auth/confirm（邮件链接兜底）
 * 2. 用 @supabase/ssr 刷新可能过期的 access token，并把新 cookie 写回响应
 *    （Server Component 自己不能写 cookie，所以这个活儿必须放在这里）
 * 3. 未登录访问受保护页面时，直接重定向到 /login
 */
export async function middleware(request: NextRequest) {
  // 还没配 Supabase 时放行，让页面自己去显示「请先配置环境变量」的提示
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  const { pathname } = request.nextUrl;

  /**
   * 邮件登录的兜底：
   * Supabase 把用户从邮件链接带回来时，落地路径取决于后台的 Redirect URLs 配置。
   * 配了 /auth/confirm 就落在那里；没配就会落回站点根路径，并带上 ?code=xxx。
   * 这里统一把带 code 的请求转交给 /auth/confirm 去换会话。
   *
   * 这一步只是改 URL，不需要问 Supabase，所以放在最前面。
   */
  const code = request.nextUrl.searchParams.get("code");
  if (code && pathname !== "/auth/confirm") {
    const confirmUrl = request.nextUrl.clone();
    confirmUrl.pathname = "/auth/confirm";
    confirmUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(confirmUrl);
  }

  // 登录页/注册页与登录态无关，直接放行 —— 省掉一次跨太平洋请求，
  // 这是"打开注册页一直转圈"的直接原因
  if (PUBLIC_AUTH_PAGES.includes(pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    // 超时：middleware 卡住的话整个请求都不会返回，页面就一直转圈
    global: { fetch: fetchWithTimeout },
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
    // Supabase 不可达 / 超时：不要让整个站点 500，放行给页面自己处理
    console.error("[middleware] 读取会话失败（已放行）：", error);
    return NextResponse.next({ request });
  }

  if (!user && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
