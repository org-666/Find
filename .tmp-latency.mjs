const base = "https://find-moment.netlify.app";

async function time(path, runs = 3) {
  const times = [];
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const started = Date.now();
    const response = await fetch(base + path, { redirect: "manual" });
    status = response.status;
    await response.text();
    times.push(Date.now() - started);
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`  ${path.padEnd(10)} HTTP ${status}   平均 ${avg}ms   （各次: ${times.join(", ")}ms）`);
  return avg;
}

console.log("--- 从你这台机器实测各页面响应（含网络往返）---");
await time("/signup");
await time("/login");
await time("/");

console.log("\n--- 对照：直接访问 Supabase（跨太平洋）---");
const started = Date.now();
try {
  const response = await fetch("https://hqtwxtsojrnvtgyrixue.supabase.co/auth/v1/health");
  await response.text();
  console.log(`  Supabase Auth   ${Date.now() - started}ms  HTTP ${response.status}`);
} catch (error) {
  console.log(`  Supabase Auth   失败 ${error.cause?.code ?? error.name}`);
}
