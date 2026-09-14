"use server";

import { revalidatePath } from "next/cache";
import { upsertProfile } from "@/lib/profile";
import { validateProfileInput, type ProfileField } from "@/lib/profile-validation";
import { getCurrentUser } from "@/lib/supabase-server";
import type { ProfileInput } from "@/lib/types";

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; field?: ProfileField; message: string };

/**
 * 保存资料（Server Action，在服务端执行）
 * 前端已经校验过一遍，这里再校验一遍——前端校验只负责体验，服务端校验才作数。
 */
export async function saveProfile(input: ProfileInput): Promise<SaveProfileResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, message: "登录状态已失效，请重新登录" };
  }

  const validated = validateProfileInput(input);
  if (!validated.ok) {
    return { ok: false, field: validated.field, message: validated.message };
  }

  try {
    await upsertProfile(user.id, validated.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message === "AGE_OUT_OF_RANGE") {
      return {
        ok: false,
        field: "birthday",
        message: "抱歉，Find 仅面向 18-30 岁用户，暂时无法完成注册。",
      };
    }
    return { ok: false, message };
  }

  revalidatePath("/");
  revalidatePath("/profile");
  return { ok: true };
}
