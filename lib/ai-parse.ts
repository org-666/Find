/**
 * AI 解析：把模糊需求翻译成结构化标签（模块 B 里 AI 的第一件正事）
 *
 * 只在服务端调用（Server Action 里），因为要读 DEEPSEEK_API_KEY / OPENAI_API_KEY，
 * 这两个 key 不能带 NEXT_PUBLIC_ 前缀，绝不能进浏览器包。
 *
 * 设计原则：AI 挂了不能让功能挂。
 * 没配 key、超时、返回不是 JSON、返回的字段不合法 —— 统统回退到本地规则解析，
 * 并在结果里标记 source，界面上明确告诉用户这是"离线解析"，不假装是 AI 干的。
 */

import { normalizeIntent, parseIntentLocally, type IntentResult, type IntentSource } from "@/lib/intent";

const REQUEST_TIMEOUT_MS = 12_000;

type Provider = {
  name: "deepseek" | "openai";
  url: string;
  model: string;
  apiKey: string;
};

export type ParsedIntent = {
  intent: IntentResult;
  source: IntentSource;
  /** 实际用的模型名，本地解析时为 null */
  model: string | null;
  /** 回退原因，用于服务端日志和界面提示 */
  note?: string;
};

/** 有 key 就用真模型，没有就走本地规则 */
export function getAiProvider(): Provider | null {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    return {
      name: "deepseek",
      url: "https://api.deepseek.com/chat/completions",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      apiKey: deepseekKey,
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      apiKey: openaiKey,
    };
  }

  return null;
}

export function isAiConfigured(): boolean {
  return getAiProvider() !== null;
}

const SYSTEM_PROMPT = `你是 Find 的需求解析器。用户会用一句很模糊的中文说他此刻想干嘛，你把它翻译成结构化标签。

分类只能是这五个之一：运动、吃饭、自习、游戏、其他。

输出严格的 JSON，不要多余文字，字段如下：
{
  "activityTag": "运动",
  "activityDetail": "打羽毛球",
  "timeWindowMinutes": 120,
  "confidence": 0.9
}

规则：
- activityDetail 是具体那件事，4-8 个字，动词开头（如"打羽毛球""吃火锅""一起自习"）。
  用户说得模糊时给最可能的那个，不要罗列多个选项。
- timeWindowMinutes 是"从现在起多少分钟内有效"，控制在 15-240 之间。
  用户说"马上"给 30，"一会儿"给 60，"今晚"给 180，没线索给 120。
- confidence 是你对自己判断的把握，0 到 1。
- 看不懂或跟上面五类都不沾边，就归到"其他"，activityDetail 用"找个人一起"。`;

async function callProvider(provider: Provider, rawInput: string): Promise<IntentResult> {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawInput },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${provider.name} 返回 ${response.status}：${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name} 没有返回内容`);

  // 模型偶尔会在 JSON 外包一层 ```json，这里容错一下
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return normalizeIntent(JSON.parse(cleaned), rawInput);
}

/** 解析入口：永远返回结果，绝不抛错（AI 不可用时静默降级） */
export async function parseIntent(rawInput: string): Promise<ParsedIntent> {
  const provider = getAiProvider();

  if (!provider) {
    return {
      intent: parseIntentLocally(rawInput),
      source: "local",
      model: null,
      note: "没有配置 DEEPSEEK_API_KEY / OPENAI_API_KEY，使用本地规则解析",
    };
  }

  try {
    const intent = await callProvider(provider, rawInput);
    return { intent, source: "ai", model: provider.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[parseIntent] AI 解析失败，回退本地规则：", message);

    return {
      intent: parseIntentLocally(rawInput),
      source: "local",
      model: null,
      note: `AI 解析失败（${message.slice(0, 120)}），已回退到本地规则`,
    };
  }
}
