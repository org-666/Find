// 按时间戳等新部署：只看创建时间晚于"推送时刻"的那条
const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
const sinceMs = Number(process.env.SINCE_MS ?? Date.now());

const headers = { authorization: `Bearer ${token}` };
const fmt = (d) => new Date(d).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

console.log(`--- 等我推送（${fmt(sinceMs)}）之后创建的部署 ---`);

for (let round = 1; round <= 20; round++) {
  const list = await (
    await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=5`, { headers })
  ).json();

  const newest = list?.[0];
  const createdMs = newest ? new Date(newest.created_at).getTime() : 0;
  const isMine = createdMs >= sinceMs - 30_000; // 容忍 30 秒时钟差

  console.log(
    `第 ${round} 轮：最新 ${newest?.id.slice(0, 8)}  ${fmt(createdMs)}  state=${newest?.state}` +
      `${isMine ? "  ← 是我这次的" : "（还是旧的）"}`,
  );

  if (isMine && (newest.state === "ready" || newest.state === "error")) {
    console.log(`\n结果: ${newest.state}`);
    if (newest.error_message) console.log(`错误: ${newest.error_message.slice(0, 400)}`);
    process.exit(newest.state === "ready" ? 0 : 1);
  }

  await new Promise((r) => setTimeout(r, 20000));
}

console.log("没等到");
process.exit(1);
