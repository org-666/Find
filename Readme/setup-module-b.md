# Find · 模块 B（说需求 + AI 解析）

> 模块 A（注册 / 资料 / 18-30 门槛）见 `setup-module-a.md`。
> 模块 B 依赖模块 A 的资料：没填过资料的用户会被自动送到 `/profile`。

## 一、这一版做了什么

用户说一句模糊的话 → AI（或本地规则）翻译成结构化标签 → 用户确认 → 进匹配池。

三步状态机，全在首页完成，不用跳页：

| 步骤 | 界面 | 说明 |
|---|---|---|
| 1 说 | 「XXX，此刻想干嘛？」+ 大输入框 + 5 个示例 chip | 输入框受控，右上角有字数统计，⌘/Ctrl+Enter 直接提交 |
| 2 确认 | 「你是想打羽毛球，对吧？」+ 分类标签 + 时间窗口 | 时间窗口可以自己改用 30 分钟 / 1 小时 / 2 小时 / 3 小时 |
| 3 匹配池 | 「正在找附近也想打羽毛球的人…」+ 剩余时间倒计时 | 可以「算了，撤回来」把需求撤回 |

右上角点城市名进 `/profile`。

## 二、AI 解析是怎么接的

**两条路径，自动切换**（`lib/ai-parse.ts`）：

- **配了 key** → 走真模型。默认 DeepSeek（`deepseek-chat`），也支持 OpenAI。
  用 `response_format: json_object` 强制返回 JSON，超时 12 秒。
- **没配 key / 超时 / 返回不是合法 JSON / 字段越界** → 自动退回 `lib/intent.ts` 里的
  **本地规则解析**（关键词表 + 时间词推断），流程完全一样跑得通。

界面上会明确标出这次是「AI 解析」还是「本地规则解析」，**不假装是 AI 干的**。

配置方式（`.env.local`，两个 key 都留空也能用）：

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-chat
# 或者
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
```

> 这两个 key 不带 `NEXT_PUBLIC_` 前缀，只在服务端读，不会进浏览器包。

**模型返回什么都兜得住**：`normalizeIntent()` 会把分类夹到五个枚举里、
时间夹到 15-240 分钟、detail 截到 30 字，认 `snake_case` 字段，
整坨垃圾输入也能退化成一次本地解析。所以 AI 挂掉不会让功能挂掉。

## 三、数据库

新增 `moments` 表，SQL 在 `supabase/migrations/20260914000200_module_b_moments.sql`。
相对 architecture.md 有两处落地调整：

1. **`time_window` 做成生成列**（由 `window_start` / `window_end` 算出的 `tstzrange`）。
   直接插 range 字面量很容易踩时区格式的坑；生成列照样能用 `&&` 做重叠查询，
   模块 C 里「同时段」就是一句 `time_window && tstzrange(now(), now() + interval '2 hours')`。
   已经配了 GiST 索引。
2. **多一个 `activity_detail`**：`activity_tag` 是粗分类（运动/吃饭/自习/游戏/其他），
   但确认页要问「你是想打羽毛球，对吧」，得存具体那件事。

本地起库后 `npm run db:reset` 会把两个模块的 SQL 按顺序跑一遍。

**数据库没起来时会怎样**：首页顶上一张黄色提示告诉你缺什么，
解析这一步照常能用，只是确认进匹配池时会返回一句人话（"数据库里还没有 moments 表…"），
不会白屏也不会报英文错。

## 四、验证清单

```bash
npm run db:start     # 起本地 Supabase（需要 Docker Desktop）
npm run dev
```

| 步骤 | 预期 |
|---|---|
| 填完资料后回到首页 | 看到「XXX，此刻想干嘛？」 |
| 输入「想动一动」→ 看看我想干嘛 | 跳到确认页：「你是想动一动，对吧？」，标签显示 `运动` |
| 输入「想找人打羽毛球」 | 确认页应该是「你是想打羽毛球，对吧？」（具体词优先于泛词） |
| 输入「今晚一起自习」 | 时间窗口默认 3 小时（从"今晚"推断） |
| 点「不太对，我再说一句」 | 回到输入页，原文字还在 |
| 点「对，就这个」 | 进入匹配池页，出现倒计时与「已等待」秒数在动 |
| 刷新页面 | 仍然是匹配池状态（需求已落库，状态是 searching） |
| 点「算了，撤回来」 | 需求状态改为 cancelled，回到输入页 |
| 清空输入后提交 | 提示「说一句你现在想干嘛」并抖动 |

## 五、目录速查

```
app/
  page.tsx                 首页：未登录=落地页；已登录=说需求（模块 B 主入口）
  say/actions.ts           Server Actions：解析 / 发布需求 / 撤回需求
components/
  SayForm.tsx              模块 B 的三步界面（客户端组件）
lib/
  intent.ts                标签体系 + 本地规则解析 + normalizeIntent（纯函数，前后端共用）
  ai-parse.ts              DeepSeek / OpenAI 调用，失败自动降级（仅服务端）
  moments.ts               moments 表读写 + 数据库错误翻译成人话（仅服务端）
supabase/migrations/
  20260914000200_module_b_moments.sql
```
