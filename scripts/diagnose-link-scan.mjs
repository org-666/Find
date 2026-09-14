// 验证假设：邮件服务商预扫描链接，会不会把同一封邮件里的验证码也一起消耗掉
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

async function makeUser(tag) {
  const email = `${tag}-${Date.now()}@example.com`;
  const created = await (
    await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ email, password: "Probe-Delete-Me-2026!", email_confirm: false }),
    })
  ).json();
  return { email, id: created.id };
}

async function generateLink(email, type) {
  return await (
    await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ type, email }),
    })
  ).json();
}

async function verify(email, token, type = "email") {
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: anon,
    body: JSON.stringify({ email, token, type }),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, msg: json?.error_description ?? json?.msg ?? "成功" };
}

// ---------- 对照组：链接没被访问过 ----------
console.log("=== 对照组：链接没人碰过 ===");
let user = await makeUser("probe-clean");
try {
  const link = await generateLink(user.email, "signup");
  console.log(`  验证码 ${link.email_otp}`);
  const result = await verify(user.email, link.email_otp);
  console.log(`  直接填码 -> HTTP ${result.status}  ${result.msg}`);
  console.log(`  → ${result.status === 200 ? "正常（这就是期望行为）" : "异常"}`);
} finally {
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: admin });
}

// ---------- 实验组：链接被"扫描器"访问过一次 ----------
console.log("\n=== 实验组：链接被预扫描过一次（模拟 163 邮箱的安全检测）===");
user = await makeUser("probe-scanned");
try {
  const link = await generateLink(user.email, "signup");
  console.log(`  验证码 ${link.email_otp}`);
  console.log(`  邮件里的链接: ${String(link.action_link).slice(0, 90)}...`);

  console.log("  模拟扫描器访问这个链接……");
  const scan = await fetch(link.action_link, { redirect: "manual" });
  console.log(`  扫描器拿到 HTTP ${scan.status}`);

  const result = await verify(user.email, link.email_otp);
  console.log(`  用户随后填码 -> HTTP ${result.status}  ${result.msg}`);
  console.log(
    `\n  → 结论：${
      result.status === 200
        ? "链接被访问不影响验证码，我的假设不成立"
        : "❗链接一旦被访问，同一封邮件里的验证码就失效了 —— 假设成立，这就是'码是对的却提示失效'的原因"
    }`,
  );
} finally {
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: admin });
}

console.log("\n清理完成");
