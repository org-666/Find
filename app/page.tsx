import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { SayForm } from "@/components/SayForm";
import { SetupNotice } from "@/components/SetupNotice";
import { signOutAction } from "@/app/actions";
import { Button, buttonStyles, Card, Chip, Notice } from "@/components/ui";
import { isAiConfigured } from "@/lib/ai-parse";
import { MomentDbError, fetchSearchingMoment } from "@/lib/moments";
import { fetchProfile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabase-server";
import type { Moment } from "@/lib/types";

// 页面内容取决于登录态，必须每次请求都重新渲染，不能静态化
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="animate-rise space-y-6">
        <Logo />
        <SetupNotice />
      </div>
    );
  }

  const user = await getCurrentUser();

  // 没登录 → 落地页
  if (!user) {
    return <Landing />;
  }

  const profile = await fetchProfile(user.id);

  // 登录了但还没填资料 —— 资料是注册流程的一部分，先去填
  if (!profile) redirect("/profile");

  let moment: Moment | null = null;
  let dbError: string | null = null;
  try {
    moment = await fetchSearchingMoment(user.id);
  } catch (error) {
    dbError = error instanceof MomentDbError ? error.message : String(error);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link
          href="/profile"
          className="flex items-center gap-2 rounded-full border-2 border-ink bg-white py-1 pl-1 pr-3 text-xs font-bold text-ink shadow-[3px_3px_0_#111111] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#111111]"
        >
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="size-7 rounded-full border-2 border-ink object-cover" />
          ) : (
            <span className="grid size-7 place-items-center rounded-full border-2 border-ink bg-sky text-[11px] font-black text-ink">
              {profile.nickname.slice(0, 1)}
            </span>
          )}
          {profile.city}
        </Link>
      </header>

      {dbError && (
        <Notice tone="warn">
          <p className="font-bold">数据库还没准备好</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">{dbError}</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">
            解析这一步不受影响，可以照常试；确认进匹配池时会写不进去。
          </p>
        </Notice>
      )}

      <SayForm initialMoment={moment} aiEnabled={isAiConfigured()} nickname={profile.nickname} />

      <form action={signOutAction} className="pt-2">
        <Button type="submit" variant="ghost" size="md">
          退出登录
        </Button>
      </form>
    </div>
  );
}

/* ---------------------------------- 落地页 ---------------------------------- */

const STEPS = [
  { n: "01", title: "说一句想干嘛", desc: "「想动一动」「有点饿」都行，不用挑活动", tone: "bg-lime" },
  { n: "02", title: "系统自动找人", desc: "只显示进度，不给人挑，也不给人看", tone: "bg-sky" },
  { n: "03", title: "你只回答两个字", desc: "去，或者算了。做完即散，不留痕迹", tone: "bg-lemon" },
] as const;

function Landing() {
  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col gap-7">
      <Logo size="lg" />

      <div className="space-y-4">
        <span className="inline-flex rotate-[-1.5deg] items-center gap-2 rounded-full border-2 border-ink bg-white px-3 py-1.5 text-xs font-bold text-ink shadow-[3px_3px_0_#111111]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-80" />
            <span className="relative inline-flex size-2 rounded-full bg-coral" />
          </span>
          附近有人和你想到一块去了
        </span>

        <h1 className="text-[42px] font-black leading-[1.02] tracking-[-0.03em] text-ink">
          此刻想干嘛
          <br />
          <span className="relative inline-block">
            <span className="relative z-10">说一句就行</span>
            {/* 荧光笔划重点：年轻人最熟悉的"手写标记"语言 */}
            <span className="absolute inset-x-[-4px] bottom-[2px] z-0 h-[42%] rotate-[-1deg] bg-lime" />
          </span>
        </h1>

        <p className="text-[15px] font-medium leading-relaxed text-ink/70">
          不用刷主页、不用挑人、不用加好友。
          <br />
          说一句你现在想干嘛，剩下的交给它。
        </p>
      </div>

      <ul className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex items-start gap-3.5">
            <span
              className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border-2 border-ink text-[11px] font-black text-ink shadow-[2px_2px_0_#111111] ${step.tone}`}
            >
              {step.n}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ink">{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">{step.desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3">
        <Link href="/signup" className={buttonStyles({ size: "lg" })}>
          创建账号
        </Link>
        <Link
          href="/login"
          className="block rounded-2xl border-2 border-ink bg-white py-3 text-center text-sm font-bold text-ink shadow-[4px_4px_0_#111111] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#111111]"
        >
          已经有账号，去登录
        </Link>
        <p className="pt-1 text-center text-xs font-medium text-ink/50">
          <Chip tone="white" className="mr-1.5 align-middle">
            18-30 岁
          </Chip>
          <Chip tone="white" className="align-middle">
            做完即散
          </Chip>
        </p>
      </div>
    </div>
  );
}
