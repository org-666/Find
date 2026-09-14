// 把迁移文件整段发到 Supabase 上执行
import { readFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const file = process.argv[2];

if (!file) {
  console.error("用法: node scripts/db-apply.mjs <迁移文件路径>");
  process.exit(1);
}

const sql = await readFile(file, "utf8");
console.log(`--- 执行 ${file}（${sql.length} 字符）---`);

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await response.text();
console.log(`--- HTTP ${response.status}`);
console.log(text.slice(0, 800));
process.exit(response.ok ? 0 : 1);
