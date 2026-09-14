// 重做诊断：针对"新用户第一次登录"这个真实场景
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

async function verify(email, token, type) {
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: anon,
    body: JSON.stringify({ email, token, type }),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, msg: json?.error_description ?? json?.msg ?? "成功", json };
}

/** 造一个"没确认过邮箱"的新用户，并拿到它的验证码 */
async function newUserWithOtp(tag) {
  const email = `${tag}-${Date.now()}@example.com`;
  const created = await (
    await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ email, password: "Probe-Delete-Me-2026!", email_confirm: false }),
    })
  ).json();

  const link = await (
    await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ type: "signup", email }),
    })
  ).json();

  return { email, id: created.id, otp: link.email_otp, linkError: link.msg };
}

// ---------- A：新用户，先按 email 类型试，再按 signup 类型试 ----------
console.log("=== A：新用户第一次登录（confirm signup 邮件）===");
let probe = await newUserWithOtp("probe-new-a");
try {
  console.log(`  验证码: ${probe.otp}（位数 ${String(probe.otp).length}）${probe.linkError ? `  链接错误: ${probe.linkError}` : ""}`);

  const first = await verify(probe.email, probe.otp, "email");
  console.log(`  ① 先按 type=email -> HTTP ${first.status}  ${first.msg}`);

  const second = await verify(probe.email, probe.otp, "signup");
  console.log(`  ② 再按 type=signup -> HTTP ${second.status}  ${second.msg}`);

  console.log(
    `  → ${first.status === 200 ? "email 类型直接就能验（我的兜底多余但无害）" : second.status === 200 ? "必须先失败再换 signup（兜底救回来了）" : "❗两种都验不过 —— 失败会作废验证码，这就是用户登不上的原因"}`,
  );
} finally {
  await fetch(`${url}/auth/v1/admin/users/${probe.id}`, { method: "DELETE", headers: admin });
}

// ---------- B：新用户，直接按 signup 类型验（不和失败尝试混合） ----------
console.log("\n=== B：新用户，直接按 signup 验（干净环境）===");
probe = await newUserWithOtp("probe-new-b");
try {
  const result = await verify(probe.email, probe.otp, "signup");
  console.log(`  按 type=signup -> HTTP ${result.status}  ${result.msg}`);
} finally {
  await fetch(`${url}/auth/v1/admin/users/${probe.id}`, { method: "DELETE", headers: admin });
}

// ---------- C：新用户，先输错一次，正确的码还能不能用 ----------
console.log("\n=== C：新用户，先输错一次，正确的码还能用吗 ===");
probe = await newUserWithOtp("probe-new-c");
try {
  const wrong = await verify(probe.email, "000000", "signup");
  console.log(`  先输错 000000 -> HTTP ${wrong.status}  ${wrong.msg}`);

  const right = await verify(probe.email, probe.otp, "signup");
  console.log(`  再输正确的码 -> HTTP ${right.status}  ${right.msg}`);
  console.log(`  → ${right.status === 200 ? "输错不作废，可以重试" : "❗输错就作废，用户必须重新发码"}`);
} finally {
  await fetch(`${url}/auth/v1/admin/users/${probe.id}`, { method: "DELETE", headers: admin });
}

console.log("\n清理完成");
