// 查 Supabase 项目当前的频率限制相关配置
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { authorization: `Bearer ${token}` },
});
const config = await response.json();

console.log(`--- GET /config/auth -> HTTP ${response.status}`);
const keys = Object.keys(config);

const rateKeys = keys.filter((k) => /rate|frequen|max|limit|exp/i.test(k));
console.log(`--- 和限制有关的字段（共 ${rateKeys.length} 个）---`);
for (const key of rateKeys) {
  const value = config[key];
  const shown = typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}...` : JSON.stringify(value);
  console.log(`  ${key} = ${shown}`);
}

console.log("--- 发送邮件相关 ---");
for (const key of keys.filter((k) => /smtp|mailer_otp|external_email|signup/i.test(k))) {
  const value = config[key];
  const shown = typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}...` : JSON.stringify(value);
  console.log(`  ${key} = ${shown}`);
}
