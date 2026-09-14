// 调高邮件发送频率限制 + 修正模板里的有效期文案
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const TEMPLATE = `<h2>你的 Find 登录验证码</h2>
<p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">{{ .Token }}</p>
<p>把这 6 位数字填到 Find 的验证码框里就能登录，1 小时内有效。</p>
<p style="color:#888888;font-size:12px;margin-top:28px">
  也可以点这个链接直接登录：<br />
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">直接登录</a>
</p>`;

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    // 默认 2 封/小时，配了自定义 SMTP 也不会自动放宽，必须显式调
    rate_limit_email_sent: 30,
    mailer_subjects_confirmation: "你的 Find 登录验证码",
    mailer_templates_confirmation_content: TEMPLATE,
    mailer_subjects_magic_link: "你的 Find 登录验证码",
    mailer_templates_magic_link_content: TEMPLATE,
  }),
});

console.log(`--- PATCH -> HTTP ${response.status}`);
if (!response.ok) {
  console.log((await response.text()).slice(0, 400));
  process.exit(1);
}

const check = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers });
const config = await check.json();

console.log("--- 回读 ---");
for (const key of [
  "rate_limit_email_sent",
  "rate_limit_otp",
  "rate_limit_verify",
  "smtp_max_frequency",
  "mailer_otp_exp",
  "mailer_otp_length",
  "disable_signup",
  "smtp_host",
]) {
  console.log(`  ${key} = ${JSON.stringify(config[key])}`);
}
const template = config.mailer_templates_magic_link_content ?? "";
console.log(`  模板含 {{ .Token }} = ${template.includes("{{ .Token }}")}`);
console.log(`  模板文案已改成 1 小时 = ${template.includes("1 小时内有效")}`);
