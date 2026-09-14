import { Card } from "@/components/ui";

/** 没配 Supabase 环境变量时显示的提示，避免开发者对着一个报错页面猜 */
export function SetupNotice() {
  return (
    <Card className="border-ink bg-lemon/40 p-5">
      <p className="mb-2.5 text-sm font-medium text-ink">还没有配置 Supabase</p>
      <ol className="list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-ink/70">
        <li>
          把 <Code>.env.local.example</Code> 复制成 <Code>.env.local</Code>
        </li>
        <li>
          填入 <Code>NEXT_PUBLIC_SUPABASE_URL</Code> 和 <Code>NEXT_PUBLIC_SUPABASE_ANON_KEY</Code>
        </li>
        <li>重启 dev server（npm run dev）</li>
      </ol>
      <p className="mt-3 border-t border-ink/20 pt-3 text-xs leading-relaxed text-ink/60">
        用本地 Supabase 的话：先开着 Docker Desktop，再执行 <Code>npm run db:start</Code>
      </p>
    </Card>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-white px-1.5 py-0.5 text-[13px] text-ink">{children}</code>
  );
}
