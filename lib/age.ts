/**
 * 年龄计算与 18-30 岁门槛（模块 A 的核心业务规则）
 *
 * 这里只做纯计算，不依赖 React / Supabase，方便被三处复用：
 * 1. 前端资料表单实时提示
 * 2. 服务端 Server Action 提交时二次校验
 * 3. （兜底）数据库触发器里的同一条规则，见 supabase/0001_users.sql
 */

/** 允许使用 Find 的最小年龄（含） */
export const MIN_AGE = 18;
/** 允许使用 Find 的最大年龄（含） */
export const MAX_AGE = 30;

const BIRTHDAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 由生日（YYYY-MM-DD）算出周岁年龄。
 * 生日格式非法、并非真实存在的日期、或生日在未来，一律返回 null。
 */
export function calculateAge(birthday: string, today: Date = new Date()): number | null {
  const matched = BIRTHDAY_PATTERN.exec(birthday.trim());
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);

  // 用 UTC 构造，避免本地时区把日期前后挪一天
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) {
    return null; // 例如 2024-02-31 这种不存在的日期
  }

  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (birthDate.getTime() > todayUtc) return null; // 生日在未来

  let age = today.getUTCFullYear() - year;
  const birthdayThisYear = Date.UTC(today.getUTCFullYear(), month - 1, day);
  if (todayUtc < birthdayThisYear) age -= 1; // 今年生日还没到

  return age;
}

export type BirthdayCheck =
  | { ok: true; age: number; birthday: string }
  | { ok: false; age: number | null; message: string };

/**
 * 校验生日是否满足 18-30 岁门槛。
 * 不通过时返回一句可以直接展示给用户的中文提示。
 */
export function checkBirthday(birthday: string, today: Date = new Date()): BirthdayCheck {
  const age = calculateAge(birthday, today);

  if (age === null) {
    return { ok: false, age: null, message: "请填写正确的出生日期" };
  }
  if (age < MIN_AGE) {
    return {
      ok: false,
      age,
      message: `抱歉，Find 仅面向 ${MIN_AGE}-${MAX_AGE} 岁用户，你目前 ${age} 岁，暂时无法注册。`,
    };
  }
  if (age > MAX_AGE) {
    return {
      ok: false,
      age,
      message: `抱歉，Find 仅面向 ${MIN_AGE}-${MAX_AGE} 岁用户，你目前 ${age} 岁，暂时无法注册。`,
    };
  }
  return { ok: true, age, birthday: birthday.trim() };
}

function toDateInputValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 给出 <input type="date"> 的 min / max，让用户在日历上就选不到非法区间。
 * max = 18 年前的今天（最小合法生日）
 * min = 31 年前的今天（最大合法生日再往前一天，精确判断仍由 checkBirthday 负责）
 */
export function birthdayInputBounds(today: Date = new Date()): { min: string; max: string } {
  const max = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
  const min = new Date(today.getFullYear() - MAX_AGE - 1, today.getMonth(), today.getDate() + 1);
  return { min: toDateInputValue(min), max: toDateInputValue(max) };
}
