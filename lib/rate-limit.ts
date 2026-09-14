/**
 * 极简限流（进程内内存版）
 *
 * 为什么需要：模块 B 的解析这一步开放给未登录用户了，
 * 如果有人写脚本刷，配了 DEEPSEEK_API_KEY 的话就是真金白银。
 *
 * 局限（原型阶段可以接受，上线前要换掉）：
 * - 内存计数，多实例部署时每个实例各算各的
 * - 进程重启就清空
 * 上线方案：换成 Upstash Redis / Vercel KV，或者直接在网关层做。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // 顺手清理过期桶，避免 Map 无限增长
  if (buckets.size > 500) {
    for (const [existingKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(existingKey);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { ok: true };
}
