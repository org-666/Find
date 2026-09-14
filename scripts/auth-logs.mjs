// 查 Supabase 的认证日志，看这次登录服务端到底报了什么错
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

const queries = [
  {
    label: "最近的认证日志",
    sql: `select timestamp, event_message from auth_logs order by timestamp desc limit 40`,
  },
];

for (const { label, sql } of queries) {
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await response.text();

  console.log(`--- ${label} -> HTTP ${response.status}`);
  if (!response.ok) {
    console.log(text.slice(0, 400));
    continue;
  }

  try {
    const json = JSON.parse(text);
    const rows = json.result ?? json.data ?? json;
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log("  （没有数据）");
      console.log(JSON.stringify(json).slice(0, 400));
      continue;
    }
    for (const row of rows) {
      const time = row.timestamp ? new Date(row.timestamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "?";
      console.log(`  ${time}  ${String(row.event_message ?? JSON.stringify(row)).slice(0, 220)}`);
    }
  } catch {
    console.log(text.slice(0, 500));
  }
}
