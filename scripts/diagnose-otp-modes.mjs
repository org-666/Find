// 摸清 GoTrue 对"登录不存在的邮箱"的处理方式，决定登录页怎么设计
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${mgmtToken}` },
  })
).json();
const anonKey = keys.find((k) => k.name === "anon")?.api_key;
const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;

const url = `https://${ref}.supabase.co`;
const admin = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
const anon = { apikey: anonKey, "content-type": "application/json" };

async function sendOtp(email, createUser) {
  const response = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: anon,
    body: JSON.stringify({ email, create_user: createUser }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    msg: json?.error_description ?? json?.msg ?? json?.error ?? "（无错误信息）",
    raw: text.slice(0, 200),
  };
}

// 造一个真实存在的用户
const existingEmail = `probe-exists-${Date.now()}@example.com`;
const created = await (
  await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email: existingEmail, password: "Probe-Delete-Me-2026!", email_confirm: true }),
  })
).json();

try {
  const unknownEmail = `probe-ghost-${Date.now()}@example.com`;

  console.log("=== 登录页会用的场景（create_user: false）===");
  const a = await sendOtp(unknownEmail, false);
  console.log(`  ① 不存在的邮箱 -> HTTP ${a.status}  ${a.msg}`);

  const b = await sendOtp(existingEmail, false);
  console.log(`  ② 已存在的邮箱 -> HTTP ${b.status}  ${b.msg}`);

  console.log("\n=== 注册页会用的场景（create_user: true）===");
  const c = await sendOtp(unknownEmail, true);
  console.log(`  ③ 不存在的邮箱 -> HTTP ${c.status}  ${c.msg}`);

  const d = await sendOtp(existingEmail, true);
  console.log(`  ④ 已存在的邮箱 -> HTTP ${d.status}  ${d.msg}`);

  console.log("\n=== 结论 ===");
  console.log(
    a.status === 200
      ? "  登录页无法通过接口区分「邮箱没注册」——GoTrue 一律返回成功（防邮箱枚举）。\n  所以登录页只能用文案引导：「还没注册过？去注册」"
      : `  登录不存在的邮箱会被拒（HTTP ${a.status}），登录页可以给出明确提示`,
  );
} finally {
  await fetch(`${url}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("\n清理完成");
}
