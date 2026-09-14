// 读 Supabase 项目的 Auth 配置（用 Management API）
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

if (!token || !ref) {
  console.error("缺少 SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF");
  process.exit(1);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { authorization: `Bearer ${token}` },
});

console.log(`--- GET /config/auth -> HTTP ${response.status}`);
if (!response.ok) {
  console.log((await response.text()).slice(0, 400));
  process.exit(1);
}

const config = await response.json();

// 只打印这次要动的字段，避免刷屏
const interesting = [
  "site_url",
  "uri_allow_list",
  "external_email_enabled",
  "mailer_autoconfirm",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_admin_email",
  "smtp_sender_name",
];

console.log("--- 关键字段当前值 ---");
for (const key of interesting) {
  const value = config[key];
  console.log(`  ${key} = ${value === undefined ? "（不存在）" : JSON.stringify(value)}`);
}

console.log("--- 所有 mailer_ 开头的字段名（用来确认模板字段叫什么）---");
const mailerKeys = Object.keys(config).filter((k) => k.startsWith("mailer_"));
for (const key of mailerKeys) {
  const value = config[key];
  const shown = typeof value === "string" ? `${value.length} 字符` : JSON.stringify(value);
  console.log(`  ${key} = ${shown}`);
}
