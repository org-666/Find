// 把本地 .env.local 里的 Supabase 配置同步到 Netlify 站点的环境变量
import { readFile } from "node:fs/promises";

const token = process.env.NETLIFY_AUTH_TOKEN;
const accountId = process.env.NETLIFY_ACCOUNT_ID;
const siteId = process.env.NETLIFY_SITE_ID;

if (!token || !accountId || !siteId) {
  console.error("缺少 NETLIFY_AUTH_TOKEN / NETLIFY_ACCOUNT_ID / NETLIFY_SITE_ID");
  process.exit(1);
}

// 1. 读 .env.local，只取 Supabase 那两条（AI key 没配就不传）
const raw = await readFile(".env.local", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const index = trimmed.indexOf("=");
  if (index === -1) continue;
  env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
}

const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter((key) => env[key]);
if (keys.length === 0) {
  console.error(".env.local 里没有找到 Supabase 配置");
  process.exit(1);
}

const payload = keys.map((key) => ({
  key,
  // context: all = 生产、预览、分支部署都用同一套
  values: [{ value: env[key], context: "all" }],
}));

const response = await fetch(`https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${siteId}`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(`--- 写入环境变量 -> HTTP ${response.status}`);

if (response.ok) {
  for (const key of keys) {
    const value = env[key];
    const masked = key.endsWith("KEY") ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
    console.log(`  ${key} = ${masked}`);
  }
} else {
  console.log(text.slice(0, 400));
}
