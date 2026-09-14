/**
 * AI 的第二件正事（architecture.md 第七节）：替双方完成第一轮时间地点确认。
 *
 * 输入是匹配结果（活动 + 模糊距离 + 时段重叠），输出是一句可以直接发出去的确认：
 *   「有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？」
 *
 * 和模块 B 一样是双路径：配了 key 走真模型，没配 / 失败 / 返回不合法就回退本地模板。
 * AI 不做的事（同样是 architecture.md 定的）：不替用户聊天、不生成对话内容。
 */

import { isAiConfigured, getAiProvider } from "@/lib/ai-parse";

export type ConfirmInput = {
  activityTag: string;
  activityDetail: string;
  /** 给用户看的模糊距离，例如「300 米内」 */
  distanceLabel: string;
  /** 内部用来估通勤时间；没有定位就是 null */
  distanceMeters: number | null;
  overlapMinutes: number;
};

export type ConfirmProposal = {
  /** 地点描述，例如「附近的羽毛球馆」 */
  place: string;
  /** 几分钟后到 */
  etaMinutes: number;
  /** 整句确认文案 */
  message: string;
  source: "ai" | "local";
  model: string | null;
  note?: string;
};

/* -------------------------------- 本地兜底 -------------------------------- */

/** 按活动猜一个合理的场地描述。真实产品里这里应该是场馆库，原型阶段先按类型给 */
function localPlace(detail: string): string {
  const table: Array<[string, string]> = [
    ["羽毛球", "附近的羽毛球馆"],
    ["篮球", "附近的篮球场"],
    ["足球", "附近的足球场"],
    ["乒乓", "附近的乒乓球馆"],
    ["网球", "附近的网球场"],
    ["台球", "附近的台球厅"],
    ["游泳", "附近的游泳馆"],
    ["健身", "附近的健身房"],
    ["跑", "附近那条跑步路线"],
    ["爬山", "山脚下的集合点"],
    ["自习", "附近的图书馆"],
    ["图书", "附近的图书馆"],
    ["咖啡", "街口那家咖啡馆"],
    ["奶茶", "附近那家奶茶店"],
    ["火锅", "附近那家火锅店"],
    ["烧烤", "附近那家烧烤摊"],
    ["夜宵", "附近的夜宵摊"],
    ["桌游", "附近的桌游店"],
    ["麻将", "附近的棋牌室"],
    ["游戏", "线上开一把"],
    ["吃", "附近的小馆子"],
  ];

  for (const [keyword, place] of table) {
    if (detail.includes(keyword)) return place;
  }
  return "附近一个方便的地方";
}

/** 通勤时间：距离越远估得越久，2-15 分钟 */
function localEta(meters: number | null): number {
  if (meters === null) return 5;
  return Math.min(15, Math.max(2, 2 + Math.round(meters / 250)));
}

export function buildLocalProposal(input: ConfirmInput): ConfirmProposal {
  const place = localPlace(input.activityDetail);
  const etaMinutes = localEta(input.distanceMeters);

  return {
    place,
    etaMinutes,
    message: `有人也想${input.activityDetail}，${etaMinutes} 分钟后到${place}，去吗？`,
    source: "local",
    model: null,
  };
}

/* ---------------------------------- AI ---------------------------------- */

const SYSTEM_PROMPT = `你是 Find 的中间人。现在有两个人在同一时段想做同一件事，你要替他们完成第一轮时间地点确认。

你要输出一句直接能发给两个人的话，告诉对方：有人也想做这件事、几分钟后在哪见、去不去。

输出严格的 JSON，不要多余文字：
{
  "place": "附近的羽毛球馆",
  "etaMinutes": 3,
  "message": "有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？"
}

规则：
- place 是一个具体的场地描述，2-12 字，不要编造不存在的店名（用"附近的羽毛球馆"这种说法）。
- etaMinutes 是整数，2 到 15 之间，根据距离远近估一个合理的通勤时间。
- message 是一句口语化的中文，必须以"去吗？"结尾，总长不超过 40 字。
- 不要出现人名、不要出现具体门牌、不要透露精确位置。`;

/** 把模型返回的任意 JSON 收敛成可信的 proposal；哪一项不合法就用本地值顶上 */
function normalizeProposal(
  raw: unknown,
  fallback: ConfirmProposal,
  activityDetail: string,
): ConfirmProposal {
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Record<string, unknown>;

  const rawPlace = typeof record.place === "string" ? record.place.trim() : "";
  const place = rawPlace.length >= 2 && rawPlace.length <= 20 ? rawPlace : fallback.place;

  const etaValue = Number(record.etaMinutes ?? record.eta);
  const etaMinutes = Number.isFinite(etaValue)
    ? Math.min(15, Math.max(2, Math.round(etaValue)))
    : fallback.etaMinutes;

  const rawMessage =
    typeof record.message === "string" ? record.message.trim().replace(/\s+/g, " ") : "";
  const messageOk = rawMessage.length >= 6 && rawMessage.length <= 60 && rawMessage.includes("去吗");
  const message = messageOk
    ? rawMessage
    : `有人也想${activityDetail}，${etaMinutes} 分钟后到${place}，去吗？`;

  return { place, etaMinutes, message, source: "ai", model: null };
}

/** 生成第一轮确认；AI 不可用时静默降级，永远返回结果 */
export async function buildConfirmProposal(input: ConfirmInput): Promise<ConfirmProposal> {
  const fallback = buildLocalProposal(input);
  const provider = getAiProvider();

  if (!provider) {
    return { ...fallback, note: "没有配置 AI key，用本地模板生成确认文案" };
  }

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `活动：${input.activityDetail}（分类：${input.activityTag}）\n` +
              `对方距离：${input.distanceLabel}\n` +
              `两人时段重叠：${input.overlapMinutes} 分钟`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`模型返回 ${response.status}`);

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型没有返回内容");

    const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const proposal = normalizeProposal(JSON.parse(cleaned), fallback, input.activityDetail);
    return { ...proposal, model: provider.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[buildConfirmProposal] AI 失败，回退本地模板：", message);
    return { ...fallback, note: `AI 生成失败（${message.slice(0, 100)}），已用本地模板` };
  }
}

export { isAiConfigured };
