// 查项目实际部署在哪里
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
  headers: { authorization: `Bearer ${token}` },
});
const project = await response.json();

console.log(`--- Supabase 项目 -> HTTP ${response.status}`);
for (const key of [
  "name",
  "id",
  "region",
  "status",
  "organization_slug",
  "created_at",
  "database",
]) {
  const value = project[key];
  console.log(`  ${key} = ${typeof value === "object" ? JSON.stringify(value).slice(0, 120) : value}`);
}

// 数据库规模/用量
const health = await fetch(`https://api.supabase.com/v1/projects/${ref}/health`, {
  headers: { authorization: `Bearer ${token}` },
});
const healthJson = await health.json().catch(() => null);
console.log(`--- 健康检查 -> HTTP ${health.status}`);
if (Array.isArray(healthJson)) {
  for (const item of healthJson) console.log(`  ${item.name}: ${item.status}`);
}

// 直连域名（前端后端各在哪）
const url = `https://${ref}.supabase.co`;
console.log("--- 各服务实际地址 ---");
console.log(`  Supabase API（数据库/认证/存储）: ${url}`);
console.log(`  Supabase 后台: https://supabase.com/dashboard/project/${ref}`);
console.log(`  应用（含后端逻辑）: https://find-moment.netlify.app`);
console.log(`  Netlify 后台: https://app.netlify.com/projects/find-moment`);
console.log(`  GitHub 仓库: https://github.com/org-666/Find`);
