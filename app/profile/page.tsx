import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { SetupNotice } from "@/components/SetupNotice";
import { fetchProfile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabase-server";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="animate-rise space-y-6">
        <Logo />
        <SetupNotice />
      </div>
    );
  }

  // middleware 已经拦过一次，这里再确认一次（服务端组件可以独立访问）
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profile = await fetchProfile(user.id);
  const fallbackLabel = user.email?.split("@")[0]?.slice(0, 4) ?? "我";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-7">
      <Logo />
      <ProfileForm userId={user.id} fallbackLabel={fallbackLabel} initial={profile} />
    </div>
  );
}
