/**
 * 临时对话里的 AI 建议
 *
 * 边界（architecture.md 第七节）：AI **不替人聊天**、不生成对话内容。
 * 所以这里只产出一句"你可以问什么"的方向提示，而且必须由用户点「用这句」才进输入框，
 * 发不发、怎么发，始终是用户自己决定。
 */

import { getAiProvider } from "@/lib/ai-parse";
import { suggestLocally, type SuggestContext } from "@/lib/chat";

export type Suggestion = {
  text: string;
  source: "ai" | "local";
  model: string | null;
  note?: string;
};

const SYSTEM_PROMPT = `两个人在 Find 上约了同一件事，现在开了一个临时对话，准备见面。

你要做的只有一件事：给其中一个人一句「接下来可以问对方什么」的提示。

严格输出 JSON，不要多余文字：
{ "suggestion": "问问他到哪了" }

规则：
- 只写一句提示，不超过 15 个字，是"该问什么"的方向，不是可以直接复制去聊天的整段话。
- 不要替用户写他要说的话，不要写"你好""在吗"这类寒暄。
- 不要出现具体人名、门牌号、精确位置。
- 用中文口语。`;

function normalizeSuggestion(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== "object") return fallback;
  const value = (raw as Record<string, unknown>).suggestion;
  if (typeof value !== "string") return fallback;

  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 3 || text.length > 20) return fallback;
  return text;
}

export async function buildSuggestion(context: SuggestContext): Promise<Suggestion> {
  const fallback = suggestLocally(context);
  const provider = getAiProvider();

  if (!provider) {
    return { text: fallback, source: "local", model: null };
  }

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `约的事：${context.activityDetail}\n` +
              `已经过了：${context.elapsedMinutes} 分钟\n` +
              `对方最后说的是：${context.lastPeerText ?? "（还没说话）"}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) throw new Error(`模型返回 ${response.status}`);

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型没有返回内容");

    const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return {
      text: normalizeSuggestion(JSON.parse(cleaned), fallback),
      source: "ai",
      model: provider.model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[buildSuggestion] AI 失败，回退本地规则：", message);
    return {
      text: fallback,
      source: "local",
      model: null,
      note: `AI 建议失败（${message.slice(0, 80)}），已用本地规则`,
    };
  }
}
