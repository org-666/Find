// 轮询 Netlify 上最新一次部署（GitHub Actions 跑完会在这里出现）
const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
const knownErrorIds = (process.env.KNOWN_ERROR_IDS ?? "").split(",").filter(Boolean);

const headers = { authorization: `Bearer ${token}` };

for (let round = 1; round <= 24; round++) {
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=3`, { headers });
  const list = await response.json().catch(() => null);

  if (!Array.isArray(list) || list.length === 0) {
    console.log(`第 ${round} 轮：拿不到部署列表（HTTP ${response.status}）`);
  } else {
    const latest = list[0];
    const isOld = knownErrorIds.includes(latest.id);
    console.log(
      `第 ${round} 轮：最新部署 ${latest.id.slice(0, 8)}  state=${latest.state}  ` +
        `${isOld ? "（还是之前失败那次，等新的）" : `context=${latest.context} branch=${latest.branch ?? "—"}`}`,
    );

    if (!isOld && (latest.state === "ready" || latest.state === "error")) {
      console.log("--- 结果 ---");
      console.log(`  state: ${latest.state}`);
      console.log(`  地址: ${latest.ssl_url || latest.url}`);
      console.log(`  提交: ${latest.commit_ref ?? "—"} ${latest.title ?? ""}`);
      if (latest.error_message) console.log(`  错误: ${latest.error_message.slice(0, 400)}`);
      if (latest.summary) console.log(`  摘要: ${JSON.stringify(latest.summary).slice(0, 300)}`);
      process.exit(latest.state === "ready" ? 0 : 1);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 20000));
}

console.log("等了 8 分钟还没有新部署出现——去 GitHub 仓库的 Actions 页面看看是不是没跑起来");
