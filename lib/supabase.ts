/**
 * Supabase 客户端（浏览器侧 / Client Component 用）
 *
 * 这里只放「能在浏览器里跑」的东西：环境变量读取 + 浏览器客户端。
 * 服务端专用的客户端在 lib/supabase-server.ts，原因见那个文件的注释。
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 所有 Supabase 请求的超时时间。
 *
 * 为什么必须有：supabase-js 默认**没有超时**。这个项目的数据库在美西、用户在国内，
 * 一次跨太平洋请求本来就要几百毫秒到一两秒，而国际线路抖动是常态。
 * 一旦某个请求卡住不返回：
 *   - 客户端：按钮永远转圈（"一直卡住"）
 *   - 服务端：整页渲染永远不返回，浏览器白屏转圈
 * 加上超时之后，最坏情况是报个错让人重试，而不是无限等待。
 */
export const SUPABASE_TIMEOUT_MS = 15_000;

/** 带超时的 fetch；调用方自己传了 signal 就不覆盖 */
export const fetchWithTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init);
  return fetch(input, { ...init, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
};

/** 读取 Supabase 环境变量；缺失时抛出带说明的错误，避免出现难以定位的 401 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "缺少 Supabase 环境变量：请在项目根目录创建 .env.local，" +
        "填入 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY（可参考 .env.local.example），然后重启 dev server。",
    );
  }

  return { url, anonKey };
}

/** 环境变量是否已配置好（页面用它决定是显示提示还是显示表单） */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

let browserClient: SupabaseClient | null = null;

/**
 * 单例浏览器客户端：会话保存在 cookie 里，
 * 这样 middleware 和 Server Component 也能读到同一个登录态。
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabaseEnv();
  browserClient = createBrowserClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
  });
  return browserClient;
}
