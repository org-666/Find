// 严格的越权测试：真造一条数据 → 访客尝试改/删 → 高权限确认数据是否被动过
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
const guest = { apikey: anonKey, "content-type": "application/json" };
const admin = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };

let failures = 0;
function report(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? "拦住" : "泄漏!"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

// ---------- 准备：造一个真实用户 + 一条真实需求（用高权限，绕过 RLS）----------
const email = `probe-guest-${Date.now()}@example.com`;
const created = await (
  await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password: "Probe-Delete-Me-2026!", email_confirm: true }),
  })
).json();
const probeUserId = created.id;

const now = Date.now();
const inserted = await (
  await fetch(`${url}/rest/v1/moments`, {
    method: "POST",
    headers: { ...admin, prefer: "return=representation" },
    body: JSON.stringify({
      user_id: probeUserId,
      raw_input: "这条是越权测试用的数据",
      activity_tag: "运动",
      activity_detail: "打羽毛球",
      window_start: new Date(now).toISOString(),
      window_end: new Date(now + 3600_000).toISOString(),
      status: "searching",
    }),
  })
).json();
const momentId = inserted[0]?.id;
console.log(`准备完成：用户 ${probeUserId}，需求 ${momentId}\n`);

try {
  console.log("--- 访客尝试（无任何会话）---");

  // 读
  const read = await fetch(`${url}/rest/v1/moments?select=id`, { headers: guest });
  const readJson = await read.json();
  report("读 moments 表", Array.isArray(readJson) && readJson.length === 0, `HTTP ${read.status} 返回 ${JSON.stringify(readJson).slice(0, 80)}`);

  // 改：把这条需求撤掉
  const patch = await fetch(`${url}/rest/v1/moments?id=eq.${momentId}`, {
    method: "PATCH",
    headers: { ...guest, prefer: "return=representation" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  const patchJson = await patch.json().catch(() => null);
  const patchTouched = Array.isArray(patchJson) && patchJson.length > 0;
  report("改别人的需求", !patchTouched, `HTTP ${patch.status} 影响行数 ${Array.isArray(patchJson) ? patchJson.length : "?"}`);

  // 删
  const del = await fetch(`${url}/rest/v1/moments?id=eq.${momentId}`, {
    method: "DELETE",
    headers: { ...guest, prefer: "return=representation" },
  });
  const delJson = await del.json().catch(() => null);
  const delTouched = Array.isArray(delJson) && delJson.length > 0;
  report("删别人的需求", !delTouched, `HTTP ${del.status} 影响行数 ${Array.isArray(delJson) ? delJson.length : "?"}`);

  // 上传文件到头像桶（带上 Authorization，测真实的存储策略）
  const upload = await fetch(`${url}/storage/v1/object/avatars/attacker/hack.jpg`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "image/jpeg" },
    body: "fake-image-bytes",
  });
  report("上传文件到头像桶", upload.status >= 400, `HTTP ${upload.status} ${(await upload.text()).slice(0, 120)}`);

  // ---------- 关键一步：用高权限回头看数据到底有没有被动过 ----------
  console.log("\n--- 高权限核对：那条数据现在长什么样 ---");
  const after = await (
    await fetch(`${url}/rest/v1/moments?id=eq.${momentId}&select=id,status,raw_input`, { headers: admin })
  ).json();
  const stillThere = Array.isArray(after) && after.length === 1;
  const untouched = stillThere && after[0].status === "searching";
  report("数据仍然存在且未被改动", untouched, `当前: ${JSON.stringify(after)}`);
} finally {
  // 清理
  await fetch(`${url}/auth/v1/admin/users/${probeUserId}`, { method: "DELETE", headers: admin });
  console.log("\n清理：临时用户及其数据已删除");
}

console.log(failures === 0 ? "\n结论：未注册的人碰不到内部数据" : `\n结论：有 ${failures} 项问题，必须修`);
process.exit(failures === 0 ? 0 : 1);
