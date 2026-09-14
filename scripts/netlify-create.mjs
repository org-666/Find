// 用 Netlify API 验证 token 并创建站点
const token = process.env.NETLIFY_AUTH_TOKEN;
if (!token) {
  console.error("没有拿到 NETLIFY_AUTH_TOKEN");
  process.exit(1);
}

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(path, init = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, { ...init, headers });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 就保留原文 */
  }
  return { status: response.status, json, text: text.slice(0, 300) };
}

// 1. 账号
const accounts = await call("/accounts");
console.log(`--- /accounts -> HTTP ${accounts.status}`);
if (!Array.isArray(accounts.json)) {
  console.log(accounts.text);
  process.exit(1);
}
for (const account of accounts.json) {
  console.log(`  账号: ${account.name}  slug=${account.slug}  id=${account.id}  类型=${account.type_name}`);
}

const account = accounts.json[0];

// 2. 现有站点
const sites = await call("/sites");
const names = Array.isArray(sites.json) ? sites.json.map((s) => s.name) : [];
console.log(`--- 现有站点 ${names.length} 个: ${names.slice(0, 8).join(", ") || "（无）"}`);

// 3. 建站点（名字被占用就换一个）
const candidates = ["find-moment", "find-now", "find-launcher", "find-moment-launcher"];
let created = null;

for (const name of candidates) {
  if (names.includes(name)) {
    console.log(`  跳过 ${name}（已存在）`);
    continue;
  }
  const result = await call("/sites", {
    method: "POST",
    body: JSON.stringify({ name, account_slug: account.slug }),
  });
  if (result.status === 201 && result.json) {
    created = result.json;
    break;
  }
  console.log(`  创建 ${name} 失败: HTTP ${result.status} ${result.text}`);
}

if (!created) {
  console.error("没能创建站点");
  process.exit(1);
}

console.log(`--- 站点已创建`);
console.log(`  名称: ${created.name}`);
console.log(`  site_id: ${created.id}`);
console.log(`  默认地址: ${created.ssl_url || created.url}`);

// 4. 写 .netlify/state.json，让 CLI 知道链接到了哪个站点
const fs = await import("node:fs/promises");
await fs.mkdir(".netlify", { recursive: true });
await fs.writeFile(
  ".netlify/state.json",
  JSON.stringify({ siteId: created.id, siteName: created.name }, null, 2),
  "utf8",
);
console.log("--- 已写入 .netlify/state.json");
