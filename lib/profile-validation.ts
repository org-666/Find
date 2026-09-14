/**
 * 资料表单的校验（纯函数，前端和服务端共用同一份规则）
 * 前端用它做即时提示，Server Action 用它做提交前的二次校验。
 */

import { checkBirthday } from "@/lib/age";
import { NICKNAME_MAX, type ProfileInput } from "@/lib/types";

export type ProfileField = "nickname" | "city" | "birthday" | "avatar";

export type ValidatedProfile =
  | { ok: true; value: ProfileInput }
  | { ok: false; field: ProfileField; message: string };

export function validateProfileInput(input: ProfileInput): ValidatedProfile {
  const nickname = input.nickname.trim();
  if (nickname.length === 0) {
    return { ok: false, field: "nickname", message: "请填写昵称" };
  }
  if (nickname.length > NICKNAME_MAX) {
    return { ok: false, field: "nickname", message: `昵称最多 ${NICKNAME_MAX} 个字` };
  }

  const city = input.city.trim();
  if (city.length === 0) {
    return { ok: false, field: "city", message: "请选择或填写所在城市" };
  }
  if (city.length > 30) {
    return { ok: false, field: "city", message: "城市名太长了" };
  }

  // 18-30 岁门槛
  const birthdayCheck = checkBirthday(input.birthday);
  if (!birthdayCheck.ok) {
    return { ok: false, field: "birthday", message: birthdayCheck.message };
  }

  if (input.avatarUrl !== null && !/^https?:\/\//.test(input.avatarUrl)) {
    return { ok: false, field: "avatar", message: "头像地址不合法，请重新上传" };
  }

  return {
    ok: true,
    value: { nickname, city, birthday: birthdayCheck.birthday, avatarUrl: input.avatarUrl },
  };
}
