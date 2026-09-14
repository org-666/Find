/**
 * 模块 B 的核心：把「想动一动」「有点饿」这种模糊表达，翻译成结构化标签。
 *
 * 这个文件是纯函数（不依赖 React / Supabase / 网络），所以：
 * - 前端确认页直接用它渲染
 * - 服务端 AI 解析完用它做归一化（防止模型返回乱七八糟的东西）
 * - 没有 AI key 时，用它做本地兜底解析，保证流程永远能跑通
 */

export const ACTIVITY_TAGS = ["运动", "吃饭", "自习", "游戏", "其他"] as const;
export type ActivityTag = (typeof ACTIVITY_TAGS)[number];

/** 时间窗口的可选档位（分钟） */
export const TIME_WINDOW_OPTIONS = [30, 60, 120, 180] as const;
export const DEFAULT_TIME_WINDOW_MINUTES = 120;
const MAX_INPUT_LENGTH = 200;
const MAX_DETAIL_LENGTH = 30;

export type IntentResult = {
  /** 粗分类，模块 C 靠它分桶 */
  activityTag: ActivityTag;
  /** 具体那件事，用来问「你是想打羽毛球，对吧？」 */
  activityDetail: string;
  /** 现在起多少分钟内有效 */
  timeWindowMinutes: number;
  /** 模型自己填的置信度 0-1，仅供参考 */
  confidence: number;
};

export type IntentSource = "ai" | "local";

/* -------------------------------- 文案工具 -------------------------------- */

export function describeTimeWindow(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟内`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} 小时内` : `约 ${hours.toFixed(1)} 小时内`;
}

export function buildConfirmQuestion(detail: string): string {
  return `你是想${detail}，对吧？`;
}

/* ------------------------------- 本地规则解析 ------------------------------- */

/**
 * 关键词表。命中越长的关键词优先级越高，
 * 所以「想打羽毛球」会命中「羽毛球」而不是「运动」。
 */
const RULES: Array<{ tag: ActivityTag; detail: string; keywords: string[] }> = [
  // 具体运动
  { tag: "运动", detail: "打羽毛球", keywords: ["羽毛球"] },
  { tag: "运动", detail: "打篮球", keywords: ["篮球"] },
  { tag: "运动", detail: "踢足球", keywords: ["足球", "踢球"] },
  { tag: "运动", detail: "打乒乓球", keywords: ["乒乓球", "乒乓"] },
  { tag: "运动", detail: "打网球", keywords: ["网球"] },
  { tag: "运动", detail: "游泳", keywords: ["游泳", "泡水"] },
  { tag: "运动", detail: "去健身", keywords: ["健身", "撸铁", "举铁"] },
  { tag: "运动", detail: "跑步", keywords: ["跑步", "慢跑", "夜跑", "跑一跑", "晨跑"] },
  { tag: "运动", detail: "骑车", keywords: ["骑车", "骑行"] },
  { tag: "运动", detail: "爬山", keywords: ["爬山", "徒步"] },
  { tag: "运动", detail: "动一动", keywords: ["动一动", "运动", "锻炼", "出汗", "活动一下"] },
  // 吃饭
  { tag: "吃饭", detail: "吃火锅", keywords: ["火锅"] },
  { tag: "吃饭", detail: "吃烧烤", keywords: ["烧烤", "撸串"] },
  { tag: "吃饭", detail: "喝奶茶", keywords: ["奶茶"] },
  { tag: "吃饭", detail: "喝咖啡", keywords: ["咖啡"] },
  { tag: "吃饭", detail: "吃夜宵", keywords: ["夜宵", "宵夜"] },
  { tag: "吃饭", detail: "吃早饭", keywords: ["早饭", "早餐"] },
  { tag: "吃饭", detail: "吃午饭", keywords: ["午饭", "午餐"] },
  { tag: "吃饭", detail: "吃晚饭", keywords: ["晚饭", "晚餐"] },
  { tag: "吃饭", detail: "吃顿饭", keywords: ["吃饭", "吃点", "干饭", "下馆子", "觅食", "约饭"] },
  { tag: "吃饭", detail: "找点吃的", keywords: ["饿", "想吃"] },
  // 自习
  { tag: "自习", detail: "去图书馆", keywords: ["图书馆"] },
  { tag: "自习", detail: "一起自习", keywords: ["自习", "学习", "看书", "写作业", "刷题", "复习", "备考"] },
  // 游戏
  { tag: "游戏", detail: "打台球", keywords: ["台球"] },
  { tag: "游戏", detail: "玩桌游", keywords: ["桌游", "狼人杀", "剧本杀"] },
  { tag: "游戏", detail: "打麻将", keywords: ["麻将"] },
  { tag: "游戏", detail: "打游戏", keywords: ["游戏", "开黑", "王者", "吃鸡", "打把", "上分", "打排位"] },
  // 兜底
  { tag: "其他", detail: "找个人一起", keywords: ["找个人", "搭子", "无聊", "陪我", "一起", "找人"] },
];

function matchRule(input: string): { tag: ActivityTag; detail: string } | null {
  let best: { tag: ActivityTag; detail: string; length: number } | null = null;

  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (!input.includes(keyword)) continue;
      if (!best || keyword.length > best.length) {
        best = { tag: rule.tag, detail: rule.detail, length: keyword.length };
      }
    }
  }

  return best ? { tag: best.tag, detail: best.detail } : null;
}

/** 从表达里猜一个时间窗口；猜不到就用默认值 */
function guessTimeWindow(input: string): number {
  if (/马上|立刻|现在就|现在|这会儿/.test(input)) return 30;
  if (/一会儿|待会|等下|半小时/.test(input)) return 60;
  if (/今晚|晚上|夜里|夜宵/.test(input)) return 180;
  if (/下午|中午|早上/.test(input)) return 120;
  return DEFAULT_TIME_WINDOW_MINUTES;
}

/** 没有 AI 时用的兜底解析（也是 AI 结果的最终归一化依据） */
export function parseIntentLocally(input: string): IntentResult {
  const text = input.trim();
  const matched = matchRule(text);

  return {
    activityTag: matched?.tag ?? "其他",
    activityDetail: matched?.detail ?? "找个人一起",
    timeWindowMinutes: guessTimeWindow(text),
    // 本地规则没有"置信度"可言，命中就 0.6，没命中 0.3，纯粹给界面一个提示
    confidence: matched ? 0.6 : 0.3,
  };
}

/* --------------------------------- 归一化 --------------------------------- */

function toTag(value: unknown): ActivityTag {
  return ACTIVITY_TAGS.includes(value as ActivityTag) ? (value as ActivityTag) : "其他";
}

function clampDetail(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim().replace(/^想/, "").slice(0, MAX_DETAIL_LENGTH);
  return text.length > 0 ? text : fallback;
}

function clampWindow(value: unknown, fallback: number): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(240, Math.max(15, Math.round(minutes)));
}

/**
 * 把 AI 返回的任意 JSON 收敛成可信的 IntentResult。
 * 模型偶尔会：给个没见过的分类、写成 "30分钟"、detail 里带一串解释——
 * 这层负责全部兜住，兜不住的字段退回首轮本地解析的结果。
 */
export function normalizeIntent(raw: unknown, rawInput: string): IntentResult {
  const fallback = parseIntentLocally(rawInput);
  if (!raw || typeof raw !== "object") return fallback;

  const record = raw as Record<string, unknown>;
  const tagValue = record.activityTag ?? record.activity_tag ?? record.tag;

  return {
    activityTag: toTag(tagValue),
    activityDetail: clampDetail(record.activityDetail ?? record.activity_detail ?? record.detail, fallback.activityDetail),
    timeWindowMinutes: clampWindow(
      record.timeWindowMinutes ?? record.time_window_minutes ?? record.minutes,
      fallback.timeWindowMinutes,
    ),
    confidence: (() => {
      const value = Number(record.confidence);
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback.confidence;
    })(),
  };
}

/** 输入是否合法（前端和服务端共用） */
export function validateRawInput(input: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim();
  if (value.length === 0) return { ok: false, message: "说一句你现在想干嘛" };
  if (value.length > MAX_INPUT_LENGTH) {
    return { ok: false, message: `一句话就够了，最多 ${MAX_INPUT_LENGTH} 个字` };
  }
  return { ok: true, value };
}

export { MAX_INPUT_LENGTH };
