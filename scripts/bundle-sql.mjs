/**
 * 把 supabase/migrations/ 下的迁移文件按顺序拼成一份一次性建表脚本。
 *
 *   npm run sql:bundle
 *
 * 为什么要有它：在 Supabase 控制台建表时，逐个文件复制粘贴很容易漏。
 * 这里把模块 A + 模块 B 的所有 SQL 合成一份，粘贴一次、Run 一次就完事。
 * 迁移文件仍然是唯一事实来源，这份产物只是便利包（已 gitignore）。
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("supabase/migrations/ 里没有 .sql 文件");
  process.exit(1);
}

const parts = [];
for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  parts.push(
    `-- ============================================================\n` +
      `-- ${file}\n` +
      `-- ============================================================\n\n` +
      sql.trim(),
  );
}

const output =
  `-- Find · 一次性建表脚本\n` +
  `-- 由 npm run sql:bundle 生成，请不要直接改这个文件，改 supabase/migrations/ 里的源文件。\n` +
  `--\n` +
  `-- 用法：Supabase Dashboard → SQL Editor → New query → 全选粘贴 → Run\n` +
  `-- 内容：模块 A（users 表 + 年龄触发器 + RLS + avatars 桶）、模块 B（moments 表 + RLS）\n` +
  `-- 全部语句都可重复执行，跑第二遍不会报错、也不会清数据。\n\n` +
  parts.join("\n\n") +
  "\n";

const target = path.join(process.cwd(), "supabase", "CLOUD-SETUP.sql");
await writeFile(target, output, "utf8");

console.log(`已生成 supabase/CLOUD-SETUP.sql（${files.length} 个迁移文件，${output.length} 字符）`);
