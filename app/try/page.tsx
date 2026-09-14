import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { SayForm } from "@/components/SayForm";
import { isAiConfigured } from "@/lib/ai-parse";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * 试玩页：不登录也能走完「说需求 → AI 解析 → 确认」，
 * 只有点「登录后进入匹配池」时才去登录。
 *
 * 为什么开放解析：解析只是把一句话翻译成标签，不写库、不碰任何用户数据，
 * 让没注册的人先感受一下"说一句就有反应"，比先要邮箱再给看强。
 */
export default async function TryPage() {
  // 已经登录的人不该走试玩路径，直接用正式流程
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser().catch(() => null);
    if (user) redirect("/");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-7">
      <Logo />
      <p className="text-xs text-zinc-400">试玩模式 · 不用登录，模块 B 三步全走一遍（不会写数据库）</p>
      <SayForm initialMoment={null} aiEnabled={isAiConfigured()} nickname="" mode="guest" />
    </div>
  );
}
