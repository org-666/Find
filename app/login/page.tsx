import { Logo } from "@/components/Logo";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <div className="animate-rise space-y-6">
        <Logo />
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-7">
      <Logo />
      <LoginForm
        initialError={
          error === "link"
            ? "这个登录链接已经失效了（可能过期、或者在别的浏览器/手机上被打开过）。回登录页重新发一次，或者直接用邮件里的 6 位验证码登录——验证码那条路不挑设备。"
            : null
        }
      />
    </div>
  );
}
