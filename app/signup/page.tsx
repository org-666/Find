import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
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
      <AuthForm
        mode="signup"
        initialError={error === "link" ? "登录链接失效或已经在别的浏览器点过了，回去重新发一次" : null}
      />
    </div>
  );
}
