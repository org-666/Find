// 第一阶段：配置不依赖 SMTP 的部分
// （模板必须在配好 SMTP 之后才能改——免费版用默认邮件服务时 Supabase 直接拒绝）
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const SITE_URL = "https://find-moment.netlify.app";
const ALLOW_LIST = [`${SITE_URL}/**`, "http://localhost:3000/**", "http://127.0.0.1:3000/**"].join(",");

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    site_url: SITE_URL,
    uri_allow_list: ALLOW_LIST,
    // 界面是 6 格并自动提交，服务端必须一致
    mailer_otp_length: 6,
  }),
});

console.log(`--- PATCH（只改 Site URL / 白名单 / 验证码位数）-> HTTP ${response.status}`);
if (!response.ok) {
  console.log((await response.text()).slice(0, 400));
  process.exit(1);
}

const check = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { authorization: `Bearer ${token}` },
});
const config = await check.json();

console.log("--- 回读确认 ---");
for (const [key, want] of Object.entries({
  site_url: SITE_URL,
  uri_allow_list: ALLOW_LIST,
  mailer_otp_length: 6,
})) {
  const got = config[key];
  console.log(`  ${String(got) === String(want) ? "OK " : "!! "} ${key} = ${JSON.stringify(got)}`);
}
