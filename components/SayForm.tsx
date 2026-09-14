"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { cancelMomentAction, parseIntentAction, publishMomentAction } from "@/app/say/actions";
import { MatchPanel, type SessionInfo } from "@/components/MatchPanel";
import { TempChat } from "@/components/TempChat";
import {
  MAX_INPUT_LENGTH,
  TIME_WINDOW_OPTIONS,
  buildConfirmQuestion,
  describeTimeWindow,
  validateRawInput,
  type ActivityTag,
  type IntentResult,
  type IntentSource,
} from "@/lib/intent";
import type { Moment } from "@/lib/types";
import { Button, Card, cn, inputBase, Notice } from "@/components/ui";

/** 一句话的例子：覆盖"很模糊"和"已经挺具体"两端 */
const EXAMPLES = ["想动一动", "有点饿", "想找人打羽毛球", "今晚想一起自习", "无聊，找个人一起"];

type Step = "input" | "confirm" | "searching" | "chat";

type Props = {
  initialMoment: Moment | null;
  aiEnabled: boolean;
  nickname: string;
};

export function SayForm({ initialMoment, aiEnabled, nickname }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialMoment ? "searching" : "input");
  const [rawInput, setRawInput] = useState(initialMoment?.raw_input ?? "");
  const [intent, setIntent] = useState<IntentResult | null>(() => (initialMoment ? intentFromMoment(initialMoment) : null));
  const [source, setSource] = useState<IntentSource | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moment, setMoment] = useState<Moment | null>(initialMoment);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function fail(message: string) {
    setError(message);
    setShakeKey((key) => key + 1); // 触发抖动
  }

  async function handleParse() {
    setError(null);

    const validated = validateRawInput(rawInput);
    if (!validated.ok) {
      fail(validated.message);
      return;
    }

    setBusy(true);
    try {
      const result = await parseIntentAction(validated.value);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setIntent(result.intent);
      setSource(result.source);
      setNote(result.note ?? null);
      setStep("confirm");
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!intent) return;
    setError(null);
    setBusy(true);

    try {
      const result = await publishMomentAction({ rawInput, intent });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setMoment(result.moment);
      setStep("searching");
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!moment) return;
    setError(null);
    setBusy(true);

    try {
      const result = await cancelMomentAction(moment.id);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setMoment(null);
      setIntent(null);
      setSource(null);
      setNote(null);
      setStep("input");
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function backToInput() {
    setStep("input");
    setError(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col gap-6">
      {step === "input" && (
        <InputStep
          textareaRef={textareaRef}
          value={rawInput}
          busy={busy}
          error={error}
          shakeKey={shakeKey}
          aiEnabled={aiEnabled}
          nickname={nickname}
          onChange={setRawInput}
          onParse={() => void handleParse()}
        />
      )}

      {step === "confirm" && intent && (
        <ConfirmStep
          rawInput={rawInput}
          intent={intent}
          source={source}
          note={note}
          busy={busy}
          error={error}
          shakeKey={shakeKey}
          onIntentChange={setIntent}
          onConfirm={() => void handlePublish()}
          onBack={backToInput}
        />
      )}

      {step === "searching" && moment && (
        <MatchPanel
          moment={moment}
          onCancel={backToInput}
          onEnterChat={(next) => {
            setSession(next);
            setStep("chat");
          }}
        />
      )}

      {step === "chat" && session && (
        <TempChat
          session={session}
          onClose={() => {
            setSession(null);
            backToInput();
          }}
        />
      )}
    </div>
  );
}

/** 页面刷新后从数据库里的那条需求还原出意图，省得再解析一次 */
function intentFromMoment(moment: Moment): IntentResult {
  const minutes = Math.round(
    (new Date(moment.window_end).getTime() - new Date(moment.window_start).getTime()) / 60_000,
  );
  return {
    activityTag: moment.activity_tag as ActivityTag,
    activityDetail: moment.activity_detail,
    timeWindowMinutes: minutes > 0 ? minutes : 120,
    confidence: 1,
  };
}

/* -------------------------------- 第一步：说 -------------------------------- */

function InputStep({
  textareaRef,
  value,
  busy,
  error,
  shakeKey,
  aiEnabled,
  nickname,
  onChange,
  onParse,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  busy: boolean;
  error: string | null;
  shakeKey: number;
  aiEnabled: boolean;
  nickname: string;
  onChange: (next: string) => void;
  onParse: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-[28px] font-black leading-tight tracking-tight text-ink">
          {nickname ? `${nickname}，此刻想干嘛？` : "此刻想干嘛？"}
        </h1>
        <p className="text-sm text-ink/55">怎么说都行，不用挑活动，也不用想好去哪儿。</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="raw-input" className="sr-only">
          你现在想干嘛
        </label>
        <textarea
          id="raw-input"
          ref={textareaRef}
          rows={3}
          value={value}
          maxLength={MAX_INPUT_LENGTH}
          placeholder="比如：想动一动 / 有点饿 / 找个人打羽毛球"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onParse();
            }
          }}
          className={cn(inputBase, "resize-none text-base leading-relaxed")}
        />
        <p className="text-right text-xs text-ink/45">
          {value.length}/{MAX_INPUT_LENGTH}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onChange(example)}
            className="rounded-full border-2 border-ink bg-white px-3 py-1.5 text-xs text-ink/70 transition hover:bg-white hover:text-ink"
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <Notice key={shakeKey} tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="mt-auto space-y-3">
        <Button type="button" loading={busy} onClick={onParse}>
          {busy ? "正在理解…" : "看看我想干嘛"}
        </Button>
        <p className="text-center text-xs text-ink/45">
          {aiEnabled ? "由 AI 把你的话翻译成标签" : "未配置 AI key，先用本地规则解析（流程一样跑通）"}
        </p>
      </div>
    </>
  );
}

/* -------------------------------- 第二步：确认 -------------------------------- */

function ConfirmStep({
  rawInput,
  intent,
  source,
  note,
  busy,
  error,
  shakeKey,
  onIntentChange,
  onConfirm,
  onBack,
}: {
  rawInput: string;
  intent: IntentResult;
  source: IntentSource | null;
  note: string | null;
  busy: boolean;
  error: string | null;
  shakeKey: number;
  onIntentChange: (next: IntentResult) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-ink/45">你说的是</p>
        <p className="rounded-2xl border-2 border-ink bg-white px-4 py-3 text-sm leading-relaxed text-ink/70">
          「{rawInput}」
        </p>
      </div>

      <Card className="p-5">
        <p className="text-lg font-medium leading-relaxed text-ink">{buildConfirmQuestion(intent.activityDetail)}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip>{intent.activityTag}</Chip>
          <Chip tone="muted">{describeTimeWindow(intent.timeWindowMinutes)}有效</Chip>
          <Chip tone="muted">{source === "ai" ? "AI 解析" : "本地规则解析"}</Chip>
        </div>

        <div className="mt-5 space-y-2 border-t border-ink/15 pt-4">
          <p className="text-xs text-ink/45">这个时间内想找到人</p>
          <div className="flex flex-wrap gap-2">
            {TIME_WINDOW_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => onIntentChange({ ...intent, timeWindowMinutes: minutes })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition",
                  minutes === intent.timeWindowMinutes
                    ? "border-ink bg-lime text-ink"
                    : "border-ink bg-white text-ink/70 hover:bg-white/80",
                )}
              >
                {describeTimeWindow(minutes).replace("内", "")}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {note && <p className="text-xs leading-relaxed text-ink/45">{note}</p>}

      {error && (
        <Notice key={shakeKey} tone="error" className="animate-shake">
          {error}
        </Notice>
      )}

      <div className="mt-auto space-y-2.5">
        <Button type="button" loading={busy} onClick={onConfirm}>
          {busy ? "正在放进匹配池…" : "对，就这个"}
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onBack} disabled={busy}>
          不太对，我再说一句
        </Button>
      </div>
    </>
  );
}


/* --------------------------------- 小组件 --------------------------------- */

function Chip({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-full border-2 border-ink px-2.5 py-1 text-xs font-bold",
        tone === "brand"
          ? "border-ink bg-lime/50 text-ink"
          : "border-ink bg-white text-ink/55",
      )}
    >
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-ink/45">{label}</dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  );
}
