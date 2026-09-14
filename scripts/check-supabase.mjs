/**
 * Supabase 体检脚本
 *
 *   npm run check:db          （等价于 node --env-file=.env.local scripts/check-supabase.mjs）
 *
 * 用它回答四个问题：
 *   1. 这个项目的地址和 key 对不对（Auth 服务通不通）
 *   2. 建表 SQL 跑了没（users / moments 表在不在）
 *   3. 头像桶建了没（avatars）
 *   4. 手机号登录开了没（会拿测试号码试一次发验证码，不会真发短信）
 *
 * 只用 anon / publishable key，不碰任何高权限密钥。
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（用 npm run check:db 会自动读 .env.local）");
  process.exit(1);
}

const headers = { apikey: key, authorization: `Bearer ${key}` };
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : "  !!  "}${name}${detail ? "  —  " + detail : ""}`);
}

/** 只提示、不算失败（例如手机号登录在测试阶段本来就不开） */
function note(name, detail) {
  console.log(`  --  ${name}${detail ? "  —  " + detail : ""}`);
}

async function probe(path, init = {}, limit = 300) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, text: text.slice(0, limit) };
}

/* 1. Auth 服务 */
try {
  const health = await probe("/auth/v1/health");
  record("Auth 服务可达", health.status === 200, `HTTP ${health.status} ${health.text}`);
} catch (error) {
  record("Auth 服务可达", false, error.message);
}

/* 2. 两张表 */
for (const table of ["users", "moments"]) {
  try {
    const res = await probe(`/rest/v1/${table}?select=id&limit=1`);
    const missing = res.status === 404 || /does not exist|Could not find the table/i.test(res.text);
    record(
      `表 public.${table}`,
      res.status === 200,
      missing ? "还没建（需要跑 supabase/migrations 里的 SQL）" : `HTTP ${res.status} ${res.text}`,
    );
  } catch (error) {
    record(`表 public.${table}`, false, error.message);
  }
}

/* 3. 头像桶
   注意：用 anon / publishable key 调 /storage/v1/bucket 只会返回空数组（RLS 挡着），
   不能用它判断桶存不存在。改成公开下载一个不存在的对象：
   - 桶存在 → 404 Object not found
   - 桶不存在 → 400 Bucket not found                                        */
try {
  const res = await probe("/storage/v1/object/public/avatars/__probe__");
  const bucketMissing = /bucket not found/i.test(res.text);
  record(
    "Storage 桶 avatars",
    !bucketMissing,
    bucketMissing
      ? `桶不存在（HTTP ${res.status}）—— SQL 里 storage.buckets 那段可能没跑成功`
      : `存在（探测不存在的文件返回 HTTP ${res.status}，符合预期）`,
  );
} catch (error) {
  record("Storage 桶 avatars", false, error.message);
}

/* 4. 登录方式开关
   读 /auth/v1/settings 就知道哪些 provider 开着，不用真发验证码占配额。 */
try {
  const res = await probe("/auth/v1/settings", {}, 4000);
  const settings = JSON.parse(res.text);
  const external = settings.external ?? {};

  record("邮箱登录", external.email === true, external.email ? "已开启（唯一的登录方式）" : "没开：Authentication → Sign In / Providers → Email");

  // 手机号已经不做，这里只提示一下云端还开着没有
  note("手机号登录", external.phone === true ? "云端还开着（项目已决定不用，可以关掉）" : "未开启（已弃用，登录只走邮箱）");

  if (settings.disable_signup) {
    record("允许新用户注册", false, "被关掉了：Authentication → Sign In / Providers 里打开 Allow new users to sign up");
  } else {
    note("允许新用户注册", "已开启");
  }
} catch (error) {
  record("登录方式开关", false, error.message);
}

const failed = results.filter((item) => !item.ok);
console.log(
  failed.length === 0
    ? "\n全部就绪，可以跑完整流程了。"
    : `\n还有 ${failed.length} 项没就绪：${failed.map((item) => item.name).join("、")}`,
);
process.exit(failed.length === 0 ? 0 : 2);
