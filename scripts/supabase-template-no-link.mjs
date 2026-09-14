// 把邮件模板改成"只有验证码、没有链接"
//
// 为什么必须去掉链接：实测证明，邮件里的链接一旦被访问（哪怕只是邮箱服务商的安全扫描），
// 同一个 token 就被消耗掉了，用户随后填那 6 位数字会报 "Token has expired or is invalid"。
// 163 / QQ 等邮箱都会预扫描链接，所以对用户来说"码是对的却总是失效"。
//
// 只放数字，就没有任何东西可被扫描。
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const TEMPLATE = `<h2>你的 Find 登录验证码</h2>

<p style="font-size:34px;font-weight:700;letter-spacing:12px;margin:24px 0;font-family:monospace">{{ .Token }}</p>

<p>把这 6 位数字填到 Find 的验证码框里就能登录，1 小时内有效。</p>

<p style="color:#888888;font-size:12px;margin-top:28px;line-height:1.6">
  这封邮件里没有链接是故意的：部分邮箱会自动扫描邮件中的链接，
  而扫描一次就会让验证码失效，所以这里只放数字。
</p>`;

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    mailer_subjects_confirmation: "你的 Find 登录验证码",
    mailer_templates_confirmation_content: TEMPLATE,
    mailer_subjects_magic_link: "你的 Find 登录验证码",
    mailer_templates_magic_link_content: TEMPLATE,
  }),
});

console.log(`--- 更新邮件模板 -> HTTP ${response.status}`);
if (!response.ok) {
  console.log((await response.text()).slice(0, 400));
  process.exit(1);
}

const check = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers })).json();
for (const key of ["mailer_templates_confirmation_content", "mailer_templates_magic_link_content"]) {
  const content = check[key] ?? "";
  console.log(`  ${key}:`);
  console.log(`    含 {{ .Token }}      = ${content.includes("{{ .Token }}")}`);
  console.log(`    含链接 <a href      = ${content.includes("<a href")}（必须是 false）`);
  console.log(`    含 {{ .TokenHash }} = ${content.includes("TokenHash")}（必须是 false）`);
}
