"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfile } from "./actions";
import { calculateAge, checkBirthday, MAX_AGE, MIN_AGE } from "@/lib/age";
import { validateProfileInput } from "@/lib/profile-validation";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { AVATAR_BUCKET, CITIES, NICKNAME_MAX, type ProfileInput, type UserProfile } from "@/lib/types";
import { Button, cn, inputBase, Notice, PageHeading, TextField } from "@/components/ui";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** 上传路径约定：avatars/{userId}/{时间戳}.{后缀}，Storage 的 RLS 靠这个前缀判断归属 */
function buildAvatarPath(userId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${userId}/${Date.now()}.${ext}`;
}

function humanizeUploadError(message: string): string {
  if (message.toLowerCase().includes("bucket not found")) {
    return "Storage 里还没有 avatars 桶：请先执行 supabase/migrations 里的建表 SQL（本地用 npm run db:reset）";
  }
  if (message.toLowerCase().includes("mime") || message.toLowerCase().includes("size")) {
    return "头像必须是 2MB 以内的 jpg / png / webp / gif";
  }
  return `头像上传失败：${message}`;
}

type Props = {
  userId: string;
  fallbackLabel: string;
  initial: UserProfile | null;
};

export function ProfileForm({ userId, fallbackLabel, initial }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial?.avatar_url ?? null);

  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  // 年龄实时计算：只要生日填齐，界面立刻给出判断结果
  const age = birthday ? calculateAge(birthday) : null;
  const ageCheck = birthday ? checkBirthday(birthday) : null;
  const ageBlocked = ageCheck !== null && !ageCheck.ok;

  async function uploadAvatar(file: File) {
    setError(null);

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setError("头像只支持 jpg / png / webp / gif");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("头像不能超过 2MB");
      return;
    }

    setUploading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const path = buildAvatarPath(userId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, { cacheControl: "3600", contentType: file.type });

      if (uploadError) {
        setError(humanizeUploadError(uploadError.message));
        return;
      }

      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input: ProfileInput = { nickname, city, birthday, avatarUrl };

    // 第一道校验（前端）：不合格就不发请求
    const local = validateProfileInput(input);
    if (!local.ok) {
      setError(local.message);
      return;
    }

    // 第二道校验在 Server Action 里，第三道在数据库触发器里
    startTransition(async () => {
      const result = await saveProfile(local.value);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  const disabled = pending || uploading;

  return (
    <form onSubmit={handleSubmit} className="animate-rise space-y-7">
      <PageHeading
        title={initial ? "修改资料" : "完善资料"}
        subtitle={initial ? "改完保存即可" : "填完就能开始说需求了"}
      />

      {/* 头像：点击或拖拽上传 */}
      <section className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void uploadAvatar(file);
          }}
          disabled={uploading}
          aria-label="上传头像"
          className={cn(
            "group relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-full transition",
            "ring-2 ring-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/25",
            dragging && "ring-2 ring-ink",
          )}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="头像预览" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center bg-gradient-to-br from-ink/15 to-mint/15 text-xl text-ink">
              {(nickname.trim() || fallbackLabel).slice(0, 1)}
            </span>
          )}
          <span className="absolute inset-0 grid place-items-center bg-ink/55 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
            {uploading ? "上传中…" : avatarUrl ? "更换" : "上传"}
          </span>
        </button>

        <div className="min-w-0 space-y-1.5">
          <p className="text-sm text-ink">头像</p>
          <p className="text-xs leading-relaxed text-ink/45">
            点击上传或把图片拖进来
            <br />
            2MB 以内，可选
          </p>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="text-xs text-ink/55 transition hover:text-ink"
            >
              移除头像
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_AVATAR_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadAvatar(file);
          }}
        />
      </section>

      <TextField
        id="nickname"
        label="昵称"
        value={nickname}
        maxLength={NICKNAME_MAX}
        placeholder="别人会看到的名字"
        hint={`最多 ${NICKNAME_MAX} 个字`}
        onChange={(event) => setNickname(event.target.value)}
      />

      <CityPicker value={city} onChange={setCity} />

      <BirthdayPicker
        value={birthday}
        onChange={setBirthday}
        age={age}
        ageBlocked={ageBlocked}
        message={ageCheck && !ageCheck.ok ? ageCheck.message : null}
      />

      {error && (
        <Notice tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="space-y-3 pb-2">
        <Button type="submit" loading={pending} disabled={disabled || ageBlocked}>
          {ageBlocked ? `仅限 ${MIN_AGE}-${MAX_AGE} 岁` : pending ? "保存中…" : "保存并继续"}
        </Button>
        {ageBlocked && (
          <p className="text-center text-xs text-ink/45">生日确认无误的话，暂时无法在 Find 注册</p>
        )}
      </div>
    </form>
  );
}

/* --------------------------------- 城市选择 --------------------------------- */

function CityPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => CITIES.filter((item) => item !== "其他"), []);
  const keyword = value.trim();

  const matched = useMemo(
    () => (keyword ? options.filter((item) => item.includes(keyword)) : options),
    [keyword, options],
  );

  const exact = options.includes(keyword as (typeof options)[number]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  return (
    <div className="relative space-y-2">
      <label htmlFor="city" className="block text-sm font-medium text-ink/55">
        城市
      </label>
      <input
        id="city"
        value={value}
        autoComplete="off"
        placeholder="搜索或直接输入城市名"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        className={cn(inputBase, exact && "border-mint/70")}
      />

      {open && matched.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-2xl border-2 border-ink bg-white p-1 shadow-[4px_4px_0_#111111]">
          {matched.map((item) => (
            <li key={item}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(item);
                  setOpen(false);
                }}
                className={cn(
                  "w-full rounded-xl px-3 py-2.5 text-left text-sm transition",
                  item === keyword
                    ? "bg-lime text-ink"
                    : "text-ink hover:bg-lime/30",
                )}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink/45">
        {exact ? "已选择常用城市" : keyword ? `将使用「${keyword}」作为城市名` : "输入城市名，或从列表里选"}
      </p>
    </div>
  );
}

/* --------------------------------- 生日选择 --------------------------------- */

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const YEAR_SPAN = 60; // 支持选到 60 岁，这样才能让 18-30 之外的年龄走到"拦截提示"

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function BirthdayPicker({
  value,
  onChange,
  age,
  ageBlocked,
  message,
}: {
  value: string;
  onChange: (next: string) => void;
  age: number | null;
  ageBlocked: boolean;
  message: string | null;
}) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: YEAR_SPAN + 1 }, (_, index) => currentYear - index),
    [currentYear],
  );

  const [yearPart = "", monthPart = "", dayPart = ""] = value ? value.split("-") : [];
  const year = Number(yearPart) || 0;
  const month = Number(monthPart) || 0;
  const day = Number(dayPart) || 0;

  const days = Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1);

  function emit(nextYear: number, nextMonth: number, nextDay: number) {
    if (!nextYear || !nextMonth || !nextDay) return;
    const lastDay = daysInMonth(nextYear, nextMonth);
    const safeDay = Math.min(nextDay, lastDay);
    const pad = (n: number) => `${n}`.padStart(2, "0");
    onChange(`${nextYear}-${pad(nextMonth)}-${pad(safeDay)}`);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink/55">生日</legend>

      <div className="grid grid-cols-3 gap-2">
        <SelectBox
          label="年"
          value={yearPart}
          placeholder="年"
          options={years.map((item) => ({ value: `${item}`, label: `${item} 年` }))}
          onChange={(next) => emit(Number(next), month, day || 1)}
        />
        <SelectBox
          label="月"
          value={monthPart}
          placeholder="月"
          options={MONTHS.map((item) => ({ value: `${item}`.padStart(2, "0"), label: `${item} 月` }))}
          onChange={(next) => emit(year, Number(next), day || 1)}
        />
        <SelectBox
          label="日"
          value={dayPart}
          placeholder="日"
          options={days.map((item) => ({ value: `${item}`.padStart(2, "0"), label: `${item} 日` }))}
          onChange={(next) => emit(year || currentYear - 25, month || 1, Number(next))}
        />
      </div>

      <p className="text-xs leading-relaxed text-ink/45">
        Find 仅面向 {MIN_AGE}-{MAX_AGE} 岁用户，生日只用于年龄校验，不对外展示。
      </p>

      {age !== null && !ageBlocked && <p className="text-xs text-mint">年龄校验通过：你今年 {age} 岁</p>}

      {ageBlocked && message && (
        <Notice tone="error" className="animate-shake">
          {message}
        </Notice>
      )}
    </fieldset>
  );
}

function SelectBox({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputBase, "appearance-none pr-8 text-center", !value && "text-ink/45")}
      >
        <option value="" disabled className="bg-white">
          {placeholder}
        </option>
        {options.map((item) => (
          <option key={item.value} value={item.value} className="bg-white text-ink">
            {item.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink/45">▾</span>
    </div>
  );
}
