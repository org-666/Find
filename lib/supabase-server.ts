/**
 * Supabase 客户端（服务端专用：Server Component / Server Action / Route Handler）
 *
 * 为什么和 lib/supabase.ts 分开？
 * 因为它用到了 next/headers 的 cookies()，而 Next.js 禁止把 next/headers 打进浏览器包。
 * 把这两类客户端放在同一个文件里，Client Component 一 import 就会报错。
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseEnv, fetchWithTimeout } from "@/lib/supabase";

/** 服务端客户端：读写当前请求的 cookie，拿到的就是这个用户的登录态 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    // 超时：服务端请求一旦卡住，整页渲染就不会返回，浏览器会一直转圈
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 渲染期间不能写 cookie（Next.js 会抛错）。
          // 刷新 token 这件事已经交给 middleware 处理了，这里忽略即可。
        }
      },
    },
  });
}

/**
 * 取当前登录用户，未登录返回 null。
 * 用 auth.getUser() 而不是 getSession()：前者会真的去 Supabase 校验 token。
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
