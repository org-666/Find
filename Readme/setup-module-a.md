# Find · 模块 A（项目初始化 + 注册 + 资料 + 18-30 校验）

## 一、本地开发（已配好，直接跑）

本地用的是一整套 Docker 版 Supabase（`supabase start`），**不需要 Supabase 账号、不花钱、离线可用**。

```bash
# 0. 前提：Docker Desktop 必须开着
npm run db:start     # 起本地 Supabase（首次会拉镜像，比较慢；之后几秒就好）
npm run dev          # 起前端 → http://localhost:3000
```

`.env.local` 已经写好了（本地地址 + anon key 是固定值）：

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> 注意：`NEXT_PUBLIC_*` 是编译时注入的，改了 `.env.local` 要重启 dev server
> （Next.js 15 通常会自动重载，日志里会打印 `Reload env: .env.local`）。

### 本地登录用测试号码（不会真发短信）

`supabase/config.toml` 里配了固定验证码，登录时手机号填下面任意一个，验证码都填 `123456`：

| 手机号 | 验证码 |
|---|---|
| `13800138000` | `123456` |
| `13900139000` | `123456` |

（第二个号码留给以后测"两个人匹配"用。）

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run db:start` | 启动本地 Supabase |
| `npm run db:stop` | 停止（保留数据） |
| `npm run db:reset` | **清库重建**：重新跑 `supabase/migrations/` 里的所有 SQL，用户数据全清 |
| `npm run db:status` | 看本地各服务地址和 key |
| `npm run typecheck` | 类型检查 |

本地后台地址：Studio（数据库可视化）http://127.0.0.1:54323 ，
API http://127.0.0.1:54321 ，数据库 54322 ，邮件测试（Mailpit）54324 。

## 二、上线到云端时要做的事

本地这套只用于开发，部署到 Vercel 时需要换成云端 Supabase 项目（代码一行都不用改）：

1. https://supabase.com/dashboard 新建项目，记下 Project URL 和 anon public key（Project Settings → API）。
2. SQL Editor → New query → 把 `supabase/migrations/20260914000000_module_a_users.sql` 整段粘进去 → Run。
   这一步会创建：`public.users` 表、`updated_at` 触发器、**年龄 18-30 的数据库触发器**、
   RLS 策略（只能读写自己那一行）、Storage 的 `avatars` 桶和头像上传策略。
3. Authentication → Sign In / Providers → 打开 **Phone**。
   真发短信需要配服务商（Twilio 等）；测试阶段可以在同一页打开 **Test OTP** 填测试号码。
4. Authentication → URL Configuration → Site URL 填正式域名。
5. Vercel 环境变量里填这两个值，把本地的 `.env.local` 换成云端地址。

> 本地 vs 云端的差别：本地固定测试验证码、云端默认真发短信；
> 其余（表、RLS、触发器、Storage）两边完全一致，因为用的是同一个 SQL 文件。

## 三、验证清单

| 步骤 | 预期 |
|---|---|
| 打开 `/` | 「Find / 此刻启动器」+「开始」按钮（未配环境变量时会显示黄色提示） |
| 点「开始」→ `/login` | 手机号输入框（中国大陆号码，自动前缀 +86） |
| 输入 `13800138000` → 获取验证码 | 进入验证码输入，出现 60 秒重发倒计时 |
| 验证码填 `123456` | 登录成功 → 自动跳到 `/profile` |
| 生日填 17 岁（如 `2009-01-01`） | 红色提示拦截，保存按钮置灰不可点 |
| 生日填 31 岁（如 `1993-01-01`） | 同样被拦截 |
| 生日填 25 岁 + 昵称/城市/头像 → 保存 | 回到首页，显示昵称、城市、年龄 |
| 退出登录后直接访问 `/profile` | 被重定向到 `/login` |

想验证数据库那道防线（前端、Server Action 都能被绕过，数据库不行），
在 Studio 的 SQL Editor 里执行（预期报 `AGE_OUT_OF_RANGE`）：

```sql
insert into public.users (id, nickname, birthday, city)
values ('00000000-0000-0000-0000-000000000000', 'test', '2015-01-01', '北京');
```

## 四、目录速查

```
app/
  page.tsx                 首页：未登录显示入口，已登录显示资料卡
  actions.ts               Server Action：退出登录
  login/page.tsx           登录页（服务端外壳）
  login/LoginForm.tsx      手机号 + 验证码表单（客户端）
  profile/page.tsx         资料页（服务端取数据）
  profile/ProfileForm.tsx  资料表单 + 头像上传 + 年龄实时校验（客户端）
  profile/actions.ts       Server Action：保存资料（服务端二次校验）
lib/
  supabase.ts              环境变量 + 浏览器客户端
  supabase-server.ts       服务端客户端（next/headers cookies）
  age.ts                   年龄计算 + 18-30 门槛（纯函数）
  profile.ts               users 表读写（服务端）
  profile-validation.ts    资料校验规则（前后端共用）
  types.ts                 数据形状 / 城市列表 / 常量
middleware.ts              会话刷新 + 未登录拦截
supabase/
  config.toml              本地 Supabase 配置（已开手机号注册 + 测试 OTP）
  migrations/…_module_a_users.sql   建表 / RLS / 触发器 / Storage 桶
```
