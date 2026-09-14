// 修：删掉旧的 request_match 重载（参数个数不同的那个），并诊断发布需求的 400
import { readFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  console.log(`  SQL -> HTTP ${response.status}  ${text.slice(0, 200)}`);
  return text;
}

console.log("--- 当前 request_match 的所有重载 ---");
await sql(`
  select p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'request_match'
`);

console.log("--- 删掉两参数版本 ---");
await sql(`drop function if exists public.request_match(double precision, integer);`);

console.log("--- 确认只剩一个 ---");
await sql(`
  select p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'request_match'
`);

// 诊断发布需求的 400：造一个临时用户真发一次，把响应体打出来
const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${token}` },
  })
).json();
const anonKey = keys.find((k) => k.name === "anon")?.api_key;
const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
const url = `https://${ref}.supabase.co`;
const admin = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };

const email = `probe-diag-${Date.now()}@example.com`;
const password = "Probe-Delete-Me-2026!";
const created = await (
  await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
).json();

try {
  const session = await (
    await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  ).json();

  const api = { apikey: anonKey, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" };
  const now = Date.now();

  console.log("--- 诊断：发布需求 ---");
  const body = {
    user_id: created.id,
    raw_input: "想找人打羽毛球",
    activity_tag: "运动",
    activity_detail: "打羽毛球",
    window_start: new Date(now).toISOString(),
    window_end: new Date(now + 120 * 60_000).toISOString(),
    status: "searching",
    location_grid: "31.230,121.474",
  };
  const response = await fetch(`${url}/rest/v1/moments`, {
    method: "POST",
    headers: { ...api, prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(`  HTTP ${response.status}`);
  console.log(`  响应: ${text.slice(0, 500)}`);

  console.log("--- 诊断：访客调 request_match ---");
  const guest = await fetch(`${url}/rest/v1/rpc/request_match`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: "{}",
  });
  console.log(`  HTTP ${guest.status}  ${(await guest.text()).slice(0, 200)}`);

  console.log("--- 诊断：登录用户调 request_match ---");
  const authed = await fetch(`${url}/rest/v1/rpc/request_match`, {
    method: "POST",
    headers: api,
    body: "{}",
  });
  console.log(`  HTTP ${authed.status}  ${(await authed.text()).slice(0, 300)}`);
} finally {
  await fetch(`${url}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("\n清理完成");
}
