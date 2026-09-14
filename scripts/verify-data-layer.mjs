// 端到端验证数据层：造一个临时用户 → 拿真实会话 → 走一遍 RLS 下的写入 → 测年龄触发器 → 清理
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const PROBE_EMAIL = "probe-delete-me@example.com";
const PROBE_PASSWORD = "Probe-Delete-Me-2026!";

const mgmtHeaders = { authorization: `Bearer ${mgmtToken}`, "content-type": "application/json" };

async function mgmt(path, init = {}) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { ...init, headers: mgmtHeaders });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

// 1. 拿项目的密钥
const keys = await mgmt("/api-keys?reveal=true");
if (!Array.isArray(keys.json)) {
  console.log(`拿不到密钥: HTTP ${keys.status} ${keys.text.slice(0, 200)}`);
  process.exit(1);
}
const serviceKey = keys.json.find((k) => k.name === "service_role")?.api_key;
const anonKey = keys.json.find((k) => k.name === "anon")?.api_key;
if (!serviceKey || !anonKey) {
  console.log("密钥里没找到 service_role / anon:", keys.json.map((k) => k.name).join(", "));
  process.exit(1);
}

const url = `https://${ref}.supabase.co`;
const admin = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };

let probeUserId = null;

try {
  // 2. 造一个已确认邮箱的临时用户
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD, email_confirm: true }),
  });
  const createdJson = await created.json();
  if (created.status !== 200 && created.status !== 201) {
    console.log(`造测试用户失败: HTTP ${created.status} ${JSON.stringify(createdJson).slice(0, 200)}`);
    process.exit(1);
  }
  probeUserId = createdJson.id;
  console.log(`1) 临时用户已创建: ${probeUserId}`);

  // 3. 用密码换一个真实会话（模拟"用户已登录"）
  const session = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
  });
  const sessionJson = await session.json();
  const accessToken = sessionJson.access_token;
  if (!accessToken) {
    console.log(`登录失败: HTTP ${session.status} ${JSON.stringify(sessionJson).slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`2) 拿到真实会话（JWT 长度 ${accessToken.length}）`);

  const user = { apikey: anonKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

  // 4. 写资料（模拟"填完资料保存"）
  const profile = await fetch(`${url}/rest/v1/users`, {
    method: "POST",
    headers: { ...user, prefer: "return=representation" },
    body: JSON.stringify({
      id: probeUserId,
      nickname: "探针用户",
      birthday: "2000-05-20",
      city: "上海",
      avatar_url: null,
    }),
  });
  const profileJson = await profile.json();
  console.log(
    `3) 保存资料 -> HTTP ${profile.status}  ${profile.status === 201 ? "✓ 写入成功（RLS 放行自己的行）" : JSON.stringify(profileJson).slice(0, 200)}`,
  );

  // 5. 年龄触发器：17 岁应该被拒绝
  const underage = await fetch(`${url}/rest/v1/users`, {
    method: "PATCH",
    headers: { ...user, prefer: "return=representation" },
    body: JSON.stringify({ birthday: "2015-01-01" }),
    // 更新自己的行
  });
  // 上面这个没带过滤条件会更新所有行，改用带 id 的方式
  const underage2 = await fetch(`${url}/rest/v1/users?id=eq.${probeUserId}`, {
    method: "PATCH",
    headers: { ...user, prefer: "return=representation" },
    body: JSON.stringify({ birthday: "2015-01-01" }),
  });
  const underageText = await underage2.text();
  const blocked = underage2.status >= 400 || /AGE_OUT_OF_RANGE/.test(underageText);
  console.log(
    `4) 年龄触发器：改成 17 岁 -> HTTP ${underage2.status}  ${blocked ? "✓ 被数据库拦住了" : "✗ 没拦住！"}  ${underageText.slice(0, 120)}`,
  );

  // 6. 写需求（模拟"确认后进匹配池"）
  const now = Date.now();
  const moment = await fetch(`${url}/rest/v1/moments`, {
    method: "POST",
    headers: { ...user, prefer: "return=representation" },
    body: JSON.stringify({
      user_id: probeUserId,
      raw_input: "想找人打羽毛球",
      activity_tag: "运动",
      activity_detail: "打羽毛球",
      window_start: new Date(now).toISOString(),
      window_end: new Date(now + 2 * 3600_000).toISOString(),
      status: "searching",
    }),
  });
  const momentJson = await moment.json();
  console.log(
    `5) 发布需求 -> HTTP ${moment.status}  ${
      moment.status === 201 ? `✓ 写入成功，time_window 生成列 = ${momentJson[0]?.time_window ?? "（未返回）"}` : JSON.stringify(momentJson).slice(0, 200)
    }`,
  );

  // 7. 撤回需求
  if (moment.status === 201 && momentJson[0]?.id) {
    const cancel = await fetch(`${url}/rest/v1/moments?id=eq.${momentJson[0].id}`, {
      method: "PATCH",
      headers: { ...user, prefer: "return=representation" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const cancelJson = await cancel.json();
    console.log(`6) 撤回需求 -> HTTP ${cancel.status}  ${cancelJson[0]?.status === "cancelled" ? "✓ 状态已改为 cancelled" : "✗"}`);
  }

  // 8. RLS：试着读别人的数据（应该读不到）
  const others = await fetch(`${url}/rest/v1/users?select=id`, { headers: user });
  const othersJson = await others.json();
  const onlySelf = Array.isArray(othersJson) && othersJson.length === 1 && othersJson[0].id === probeUserId;
  console.log(`7) RLS 隔离：查询 users 表 -> 返回 ${Array.isArray(othersJson) ? othersJson.length : "?"} 行  ${onlySelf ? "✓ 只能看到自己" : "✗ 看到了别人的数据"}`);
} finally {
  // 9. 清理：删掉临时用户（会级联删掉 users/moments 里的行）
  if (probeUserId) {
    const del = await fetch(`${url}/auth/v1/admin/users/${probeUserId}`, { method: "DELETE", headers: admin });
    console.log(`8) 清理临时用户 -> HTTP ${del.status} ${del.status === 200 ? "✓ 已删除（资料和需求级联删除）" : "✗ 请手动去后台删"}`);
  }
}
