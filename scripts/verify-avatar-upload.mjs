// 验证：登录用户上传头像（这条路径之前只验过"访客被拒"，没验过"本人能传"）
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

const email = `probe-avatar-${Date.now()}@example.com`;
const password = "Probe-Delete-Me-2026!";

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "!!  "}${label}${detail ? `   ${detail}` : ""}`);
}

const created = await (
  await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
).json();

try {
  const session = await (
    await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  ).json();
  const token = session.access_token;
  check("拿到登录会话", Boolean(token));

  // 一张最小的合法 PNG
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  const path = `${created.id}/probe.png`;

  // 1. 上传到自己目录下（RLS 允许的路径）
  const upload = await fetch(`${url}/storage/v1/object/avatars/${path}`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "image/png" },
    body: png,
  });
  check("本人上传头像到自己目录", upload.status === 200, `HTTP ${upload.status} ${(await upload.text()).slice(0, 120)}`);

  // 2. 上传到别人的目录（应该被拒）
  const evil = await fetch(`${url}/storage/v1/object/avatars/00000000-0000-0000-0000-000000000000/evil.png`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "image/png" },
    body: png,
  });
  check("上传到别人目录被拒", evil.status >= 400, `HTTP ${evil.status}`);

  // 3. 取公开地址能读到（桶是 public）
  const publicUrl = `${url}/storage/v1/object/public/avatars/${path}`;
  const download = await fetch(publicUrl);
  check("通过公开地址能读到", download.status === 200, `HTTP ${download.status}`);

  // 4. 把地址写进 users 表
  const profile = await fetch(`${url}/rest/v1/users`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      id: created.id,
      nickname: "探针",
      birthday: "2000-05-20",
      city: "上海",
      avatar_url: publicUrl,
    }),
  });
  check("资料里存下头像地址", profile.status === 201, `HTTP ${profile.status}`);
} finally {
  await fetch(`${url}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("\n清理：临时用户已删除");
}

console.log(failures === 0 ? "\n结论：头像上传链路可用" : `\n结论：有 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
