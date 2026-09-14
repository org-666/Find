// 等新部署：先记录基线 id，再等出现一个不同的
const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
const headers = { authorization: `Bearer ${token}` };

const describe = (d) =>
  `  ${d.id.slice(0, 8)}  ${new Date(d.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}  state=${d.state}`;

async function latest() {
  const list = await (
    await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=5`, { headers })
  ).json();
  return Array.isArray(list) ? list : [];
}

const baseline = (await latest())[0];
console.log("--- 基线（推送前的最新部署）---");
console.log(describe(baseline));

for (let round = 1; round <= 30; round++) {
  const list = await latest();
  const target = list[0]; // 只看最新的那条：它的 id 变了才说明是我的推送构建出来了（不能随便 find 一个不同的，那样会挑到更旧的）

  console.log(
    `第 ${round} 轮：最新 ${target?.id.slice(0, 8)} state=${target?.state}` +
      `${target?.id === baseline.id ? "（还是基线，等新的）" : "  ← 新部署"}`,
  );

  if (target && target.id !== baseline.id && (target.state === "ready" || target.state === "error")) {
    console.log("--- 新部署结果 ---");
    console.log(describe(target));
    console.log(`  地址: ${target.ssl_url || target.url}`);
    if (target.error_message) console.log(`  错误: ${target.error_message.slice(0, 500)}`);
    process.exit(target.state === "ready" ? 0 : 1);
  }

  await new Promise((r) => setTimeout(r, 20000));
}

console.log("等了 10 分钟没等到新部署");
process.exit(1);
