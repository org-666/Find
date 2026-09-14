// 用 Management API 直接查数据库，看现在有哪些表和函数
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`查询失败 HTTP ${response.status}: ${text.slice(0, 300)}`);
    return null;
  }
  return JSON.parse(text);
}

const tables = await sql(`
  select table_name, (select count(*) from information_schema.columns c
                      where c.table_schema = t.table_schema and c.table_name = t.table_name) as columns
  from information_schema.tables t
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`);
console.log("--- public 下的表 ---");
for (const row of tables ?? []) console.log(`  ${row.table_name}  (${row.columns} 列)`);

const fns = await sql(`
  select routine_name, routine_type
  from information_schema.routines
  where routine_schema = 'public'
  order by routine_name
`);
console.log("--- public 下的函数 ---");
for (const row of fns ?? []) console.log(`  ${row.routine_name}`);

const policies = await sql(`
  select tablename, policyname, cmd
  from pg_policies where schemaname = 'public' order by tablename, policyname
`);
console.log("--- RLS 策略 ---");
for (const row of policies ?? []) console.log(`  ${row.tablename}.${row.policyname}  (${row.cmd})`);
