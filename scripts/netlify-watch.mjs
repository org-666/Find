// 轮询构建状态
const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
const deployId = process.env.DEPLOY_ID;

const headers = { authorization: `Bearer ${token}` };

async function get(path) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, { headers });
  return { status: response.status, json: await response.json().catch(() => null) };
}

for (let round = 1; round <= 20; round++) {
  const result = await get(`/sites/${siteId}/deploys/${deployId}`);
  if (!result.json) {
    console.log(`第 ${round} 轮：拿不到状态（HTTP ${result.status}）`);
  } else {
    const d = result.json;
    console.log(
      `第 ${round} 轮：state=${d.state}  ${d.error_message ? "错误=" + d.error_message : ""}${
        d.summary ? "  " + JSON.stringify(d.summary).slice(0, 200) : ""
      }`,
    );

    if (d.state === "ready" || d.state === "error") {
      console.log("--- 最终状态 ---");
      console.log(`  state: ${d.state}`);
      console.log(`  地址: ${d.ssl_url || d.url}`);
      console.log(`  构建日志: ${d.admin_url ? d.admin_url + "/deploys/" + d.id : d.log_access_attributes?.url ?? "—"}`);
      if (d.error_message) console.log(`  错误: ${d.error_message}`);
      process.exit(d.state === "ready" ? 0 : 1);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}

console.log("等了 5 分钟还没结束，去后台看吧");
