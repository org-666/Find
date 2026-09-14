// 第二阶段：配 SMTP + 邮件模板（配了自定义 SMTP 之后，模板才允许修改）
import { readFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const SITE_URL = "https://find-moment.netlify.app";
const MAIL = "szc625810@163.com";
const AUTH_CODE = process.env.MAIL_AUTH_CODE;

if (!AUTH_CODE) {
  console.error("缺少 MAIL_AUTH_CODE");
  process.exit(1);
}

const TEMPLATE = `<h2>你的 Find 登录验证码</h2>
<p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">{{ .Token }}</p>
<p>把这 6 位数字填到 Find 的验证码框里就能登录，5 分钟内有效。</p>
<p style="color:#888888;font-size:12px;margin-top:28px">
  也可以点这个链接直接登录：<br />
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">直接登录</a>
</p>`;

const payload = {
  smtp_host: "smtp.163.com",
  // 注意：这个接口的 smtp_port 必须是字符串，传数字会报 400
  smtp_port: "465",
  smtp_user: MAIL,
  smtp_pass: AUTH_CODE,
  smtp_admin_email: MAIL,
  smtp_sender_name: "Find",
  // 配了 SMTP 之后模板才可改
  mailer_subjects_confirmation: "你的 Find 登录验证码",
  mailer_templates_confirmation_content: TEMPLATE,
  mailer_subjects_magic_link: "你的 Find 登录验证码",
  mailer_templates_magic_link_content: TEMPLATE,
};

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers,
  body: JSON.stringify(payload),
});
console.log(`--- PATCH（SMTP + 模板）-> HTTP ${response.status}`);
if (!response.ok) {
  console.log((await response.text()).slice(0, 500));
  process.exit(1);
}

// 回读确认
const check = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers });
const config = await check.json();

console.log("--- 回读确认 ---");
let bad = 0;
const expect = {
  smtp_host: "smtp.163.com",
  smtp_port: "465",
  smtp_user: MAIL,
  smtp_admin_email: MAIL,
  smtp_sender_name: "Find",
  site_url: SITE_URL,
  mailer_otp_length: 6,
};
for (const [key, want] of Object.entries(expect)) {
  const got = config[key];
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "OK " : "!! "} ${key} = ${JSON.stringify(got)}`);
}
console.log(`  ${config.smtp_pass ? "OK " : "!! "} smtp_pass = ${config.smtp_pass ? "已设置（不明文回显）" : "空"}`);
for (const key of ["mailer_templates_confirmation_content", "mailer_templates_magic_link_content"]) {
  const ok = (config[key] ?? "").includes("{{ .Token }}");
  if (!ok) bad++;
  console.log(`  ${ok ? "OK " : "!! "} ${key} 含 {{ .Token }}（${(config[key] ?? "").length} 字符）`);
}

// 真发一封验证码邮件
const raw = await readFile(".env.local", "utf8");
const anonKey = raw.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();
const url = raw.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();

console.log("--- 真发一封验证码邮件 ---");
const otp = await fetch(`${url}/auth/v1/otp`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email: MAIL, create_user: true }),
});
const otpText = await otp.text();
console.log(`  POST /auth/v1/otp -> HTTP ${otp.status}`);
console.log(`  响应: ${otpText.slice(0, 300)}`);

console.log(bad === 0 ? "\n配置全部生效" : `\n有 ${bad} 项没生效`);
