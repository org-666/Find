# Find · 模块 C / D / E（匹配 → 双方确认 → 临时对话）

**正式版。试玩模式已砍掉**——现在内部功能只有注册用户能用，匹配的是真人。

线上：https://find-moment.netlify.app

## 一、完整流程

| 步骤 | 界面 | 模块 |
|---|---|---|
| 1 | 说一句「想找人打羽毛球」→ AI 解析成标签 | B |
| 2 | 「你是想打羽毛球，对吧？」→ 确认 → 写进匹配池 | B |
| 3 | 「正在找附近也想打羽毛球的人…」 | C |
| 4 | 「**有人也想打羽毛球，3 分钟后到附近的羽毛球馆，去吗？**」+ 距离档位、时段重叠 | C |
| 5 | 去 / 算了（**双方各自看到同一句 AI 文案**） | D |
| 6 | 我点去 → 「等对方」；对方也点去 → 「成了」 | D |
| 7 | 进临时对话：只有 我到了 / 我晚点 / 算了 | E |
| 8 | 时间到自动关闭 / 手动结束 → 消息**物理删除** | E |

## 二、匹配为什么必须放在数据库里

RLS 只允许用户读自己那一行，所以拿客户端密钥**根本看不到别人的需求**，匹配只能在数据库侧做。

但数据库函数是 `security definer`（有权限看全部），所以它被刻意设计成**只返回模糊信息**：

```sql
request_match() returns (match_id, activity_detail, distance_label, overlap_minutes, is_initiator)
```

**没有对方是谁、没有对方 id、没有精确坐标。** 这是"不展示人"这条产品原则在技术上的落点——不是前端不显示，是后端根本不给。

## 三、数据模型

| 表 | 作用 | 谁能读 |
|---|---|---|
| `matches` | 一次配对 + 双方各自的决定 + AI 文案 | 只有当事人（RLS） |
| `sessions` | 双方都去之后开的临时局 | 只有当事人 |
| `session_messages` | 临时对话的消息 | 只有当事人，**局结束物理删除** |

写操作一律不给 RLS 策略，全部走 `security definer` 函数（`request_match` / `respond_match` / `set_match_proposal` / `send_session_message` / `close_session`），并且 `revoke ... from anon`——访客连函数都调不到（实测返回 `permission denied`）。

### 配对规则

```
同 activity_tag + 同 activity_detail
  + 时间窗重叠 ≥ 15 分钟
  + 距离 ≤ 1500 米（Haversine 真算）
  + 30 分钟内被我或对方拒过的人，冷却期内不再配
```

距离档位对外只有 `200 米内 / 500 米内 / 1 公里内 / 附近`。

## 四、双用户端到端验证

`node scripts/verify-real-matching.mjs`（用管理密钥造两个临时用户，跑完删除）：

```
OK  A/B 发布需求                   HTTP 201
OK  访客调用匹配函数被拒            HTTP 401 permission denied
OK  A 发起匹配                     距离「200 米内」重叠 110 分钟
OK  返回里没有对方身份             只含 match_id / 距离档位 / 重叠时长
OK  B 看到同一局 + 同一句 AI 文案
OK  A 点去 → pending；B 也点去 → confirmed，开出临时局
OK  B 读到 2 条消息，mine 标记正确
OK  结束前数据库有 2 条消息 → 结束后物理删除，剩 0 条
OK  结案后两人需求都不再是 searching
```

**这套测试抓出了三个真 bug**，值得记下来：

1. **`create or replace function` 遇到参数个数不同会新建函数**，不是替换。于是数据库里出现两个 `request_match`，PostgREST 报 `PGRST203` 选不出用哪个。
2. **`moments` 表少了 `location_grid` 列**。我把定位建在了 `users` 上，忘了需求也要带位置（应该跟着需求走，不该跟着资料走）。而 **plpgsql 创建函数时不校验列名**，所以这个错误要到真正匹配时才炸。
3. **`respond_match` 返回值里"我方/对方"标反了**，因为建配对时把对方存成 `user_a`、发起人存成 `user_b`，函数却直接返回 a/b 两个字段。同时"双方都去"之后返回的 status 还是旧值（没刷新本地变量）。

## 五、已知限制

| 项 | 现状 | 什么时候必须处理 |
|---|---|---|
| 实时性 | 用**轮询**（找 5 秒 / 等对方 3 秒 / 消息 2 秒），不是 Supabase Realtime | 用户量上来、觉得不够"活"的时候换 Realtime |
| 自动关局 | 客户端到点会调 `close_session`；`expire_sessions()` 函数已写好，但**没挂定时任务** | 挂 pg_cron，否则用户关掉页面就没人关局了 |
| 冷却期 | 拒过之后 30 分钟内不再配对（防骚扰死循环） | — |
| 头像/定位 | 定位字段已建好但**没有采集 UI**，目前匹配的距离档位是"附近" | 做模块 C 的定位授权 |

## 六、目录

```
supabase/migrations/
  20260915000300_module_cde_real_matching.sql   匹配引擎 + 三张表 + 七个函数
  20260915000400_match_decline_cooldown.sql     拒绝冷却（防反复骚扰）
  20260915000500_moments_location.sql           补 moments.location_grid
  20260915000600_fix_respond_match.sql          修返回值方向与状态刷新
app/match/actions.ts    发起/轮询/回应（走数据库函数）
app/chat/actions.ts     读消息/发消息/结束这一局/AI 建议
components/MatchPanel.tsx   模块 C+D 界面
components/TempChat.tsx     模块 E 界面
lib/chat.ts             纯逻辑（三个按钮、倒计时、本地建议）
lib/ai-confirm.ts       AI 生成第一轮确认文案
lib/ai-suggest.ts       AI 给一句提示（不替人聊天）
```

## 七、怎么测

**需要两个真实账号**（两个邮箱），因为对面得是真人：

1. 浏览器 A 登录账号 1，说「想找人打羽毛球」
2. 浏览器 B 登录账号 2，说同一句话（同活动、时间窗要重叠）
3. 谁先发起都没关系：先进池子的人会被后进来的人配上
4. 双方各自看到同一句确认文案 → 都点「去」
5. 开出临时对话，互相发消息，然后结束这一局
6. 去 Supabase 的 `session_messages` 表确认：**一条都不剩**
