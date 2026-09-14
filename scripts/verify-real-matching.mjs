// 双用户端到端验证：匹配 → AI 确认 → 双方去 → 开临时局 → 真实消息 → 结束即物理删除
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

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "!!  "}${label}${detail ? `   ${detail}` : ""}`);
}

async function makeUser(tag) {
  const email = `probe-${tag}-${Date.now()}@example.com`;
  const password = "Probe-Delete-Me-2026!";
  const created = await (
    await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
  ).json();

  const session = await (
    await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  ).json();

  return {
    id: created.id,
    token: session.access_token,
    api: { apikey: anonKey, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
  };
}

const A = await makeUser("a");
const B = await makeUser("b");
console.log(`准备：A=${A.id.slice(0, 8)}  B=${B.id.slice(0, 8)}\n`);

try {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  // 两人各自发一条同活动、时段重叠、相距约 170 米的需求
  for (const [who, user, grid, shiftMin] of [
    ["A", A, "31.230,121.474", 0],
    ["B", B, "31.2315,121.474", 10],
  ]) {
    const r = await fetch(`${url}/rest/v1/moments`, {
      method: "POST",
      headers: { ...user.api, prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        raw_input: "想找人打羽毛球",
        activity_tag: "运动",
        activity_detail: "打羽毛球",
        window_start: iso(now + shiftMin * 60_000),
        window_end: iso(now + 120 * 60_000),
        status: "searching",
        location_grid: grid,
      }),
    });
    check(`${who} 发布需求`, r.status === 201, `HTTP ${r.status}`);
  }

  // 访客不能调匹配函数
  const guestCall = await fetch(`${url}/rest/v1/rpc/request_match`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: "{}",
  });
  check("访客调用匹配函数被拒", guestCall.status >= 400, `HTTP ${guestCall.status}`);

  // A 发起匹配
  const matched = await (
    await fetch(`${url}/rest/v1/rpc/request_match`, { method: "POST", headers: A.api, body: "{}" })
  ).json();
  check("A 发起匹配成功", Array.isArray(matched) && matched.length === 1, JSON.stringify(matched));
  if (!Array.isArray(matched) || matched.length === 0) throw new Error("没配上");
  const matchId = matched[0].match_id;
  console.log(`     匹配结果：距离「${matched[0].distance_label}」 重叠 ${matched[0].overlap_minutes} 分钟`);
  check("返回里没有对方身份", !JSON.stringify(matched[0]).match(/user|nickname|email/), JSON.stringify(matched[0]));
  check("算出的距离是 200 米内", matched[0].distance_label === "200 米内", matched[0].distance_label);

  // AI 文案（这里直接写死一句，真流程里由 Node 侧的 AI 生成）
  await fetch(`${url}/rest/v1/rpc/set_match_proposal`, {
    method: "POST",
    headers: A.api,
    body: JSON.stringify({
      p_match_id: matchId,
      p_place: "附近的羽毛球馆",
      p_eta_minutes: 3,
      p_confirm_message: "有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？",
    }),
  });

  // B 也应该看到同一句
  const bView = await (
    await fetch(`${url}/rest/v1/rpc/get_my_match`, { method: "POST", headers: B.api, body: "{}" })
  ).json();
  check("B 看到同一局", Array.isArray(bView) && bView.length === 1, JSON.stringify(bView?.[0]?.match_id));
  check(
    "B 看到同一句 AI 文案",
    bView?.[0]?.confirm_message === "有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？",
    bView?.[0]?.confirm_message,
  );
  check("B 的 my_decision 是待回应", bView?.[0]?.my_decision === "pending", bView?.[0]?.my_decision);

  // 双方都点「去」
  const aGo = await (
    await fetch(`${url}/rest/v1/rpc/respond_match`, {
      method: "POST",
      headers: A.api,
      body: JSON.stringify({ p_match_id: matchId, p_decision: "go" }),
    })
  ).json();
  check("A 点去之后还没开成", aGo?.[0]?.status === "pending", JSON.stringify(aGo?.[0]));

  const bGo = await (
    await fetch(`${url}/rest/v1/rpc/respond_match`, {
      method: "POST",
      headers: B.api,
      body: JSON.stringify({ p_match_id: matchId, p_decision: "go" }),
    })
  ).json();
  check("双方都去 → 状态变 confirmed", bGo?.[0]?.status === "confirmed", JSON.stringify(bGo?.[0]));

  const sessionId = (
    await (await fetch(`${url}/rest/v1/rpc/get_my_match`, { method: "POST", headers: A.api, body: "{}" })).json()
  )?.[0]?.session_id;
  check("临时局已开出", Boolean(sessionId), String(sessionId));

  // 真实消息：A 发一条，B 能读到，并且 mine 标记正确
  await fetch(`${url}/rest/v1/rpc/send_session_message`, {
    method: "POST",
    headers: A.api,
    body: JSON.stringify({ p_session_id: sessionId, p_kind: "text", p_body: "我在门口等你" }),
  });
  await fetch(`${url}/rest/v1/rpc/send_session_message`, {
    method: "POST",
    headers: B.api,
    body: JSON.stringify({ p_session_id: sessionId, p_kind: "status", p_body: "我到了" }),
  });

  const bMessages = await (
    await fetch(`${url}/rest/v1/rpc/get_session_messages`, {
      method: "POST",
      headers: B.api,
      body: JSON.stringify({ p_session_id: sessionId }),
    })
  ).json();
  check("B 读到 2 条消息", Array.isArray(bMessages) && bMessages.length === 2, `实际 ${bMessages?.length}`);
  check(
    "A 发的对 B 显示为「不是我的」",
    bMessages?.[0]?.mine === false && bMessages?.[0]?.body === "我在门口等你",
    JSON.stringify(bMessages?.[0]),
  );
  check(
    "B 自己发的标记为我发的",
    bMessages?.[1]?.mine === true && bMessages?.[1]?.body === "我到了",
    JSON.stringify(bMessages?.[1]),
  );

  // 结束这一局 → 消息必须被物理删除
  const before = await (
    await fetch(`${url}/rest/v1/session_messages?session_id=eq.${sessionId}&select=id`, { headers: admin })
  ).json();
  check("结束前数据库里确实有消息", Array.isArray(before) && before.length === 2, `实际 ${before?.length}`);

  await fetch(`${url}/rest/v1/rpc/close_session`, {
    method: "POST",
    headers: A.api,
    body: JSON.stringify({ p_session_id: sessionId }),
  });

  const after = await (
    await fetch(`${url}/rest/v1/session_messages?session_id=eq.${sessionId}&select=id`, { headers: admin })
  ).json();
  check("结束后消息被物理删除（不留记录）", Array.isArray(after) && after.length === 0, `实际 ${after?.length}`);

  // 结束之后双方的需求应该回到 expired，不再匹配
  const moments = await (
    await fetch(`${url}/rest/v1/moments?select=status,user_id`, { headers: admin })
  ).json();
  check(
    "结案后两人的需求都不再是 searching",
    Array.isArray(moments) && moments.every((m) => m.status !== "searching"),
    JSON.stringify(moments),
  );
} finally {
  for (const user of [A, B]) {
    await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: admin });
  }
  console.log("\n清理：两个临时用户及其数据已删除");
}

console.log(failures === 0 ? "\n结论：真匹配 / 双方确认 / 临时对话 / 不留记录 全部跑通" : `\n结论：有 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
