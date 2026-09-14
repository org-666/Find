// 可靠验证：轮询线上 JS 包里有没有出现新代码的标记，出现即说明部署完成
const base = "https://find-moment.netlify.app";
const needle = "find-auth-"; // 这次新增的 sessionStorage key 前缀

async function hasNewCode() {
  const page = await (await fetch(`${base}/signup`)).text();
  const srcs = [...new Set([...page.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]))];

  for (const src of srcs) {
    const url = src.startsWith("http") ? src : base + (src.startsWith("/") ? src : "/" + src);
    try {
      const text = await (await fetch(url)).text();
      if (text.includes(needle)) return true;
    } catch {
      /* 单个文件失败不影响 */
    }
  }
  return false;
}

for (let round = 1; round <= 20; round++) {
  const found = await hasNewCode();
  console.log(`第 ${round} 轮：线上包里${found ? "已找到" : "还没有"}新代码（${needle}）`);

  if (found) {
    console.log("\n部署完成，新代码已上线");
    process.exit(0);
  }

  await new Promise((r) => setTimeout(r, 20000));
}

console.log("\n等了 6 分钟还没看到新代码");
process.exit(1);
