# Find · 登录（邮箱验证码）

**当前状态：已配好，可用。** 登录方式只有邮箱，手机号已从代码里移除。

## 一、线上配置（已通过 Management API 配好）

| 项 | 值 |
|---|---|
| Site URL | `https://find-moment.netlify.app` |
| Redirect URLs | `https://find-moment.netlify.app/**`、`http://localhost:3000/**`、`http://127.0.0.1:3000/**` |
| SMTP | `smtp.163.com:465`，发件人 `szc625810@163.com`，发件人名 `Find` |
| 验证码位数 | **6**（必须和界面的 6 格一致） |
| 邮件模板 | Confirm signup / Magic Link 两个都已改成含 `{{ .Token }}` + `{{ .TokenHash }}` 直连链接 |

配置脚本：`scripts/supabase-setup-auth.mjs`（Site URL 等）、`scripts/supabase-setup-smtp.mjs`（SMTP + 模板）。

## 二、踩坑记录（重要）

### 1. 免费版默认邮件服务不允许改模板

第一次改模板时 Supabase 直接拒绝：

```
Email template modification is not available for free tier projects using the default email provider.
Please upgrade your plan or configure a custom SMTP provider.
```

**所以"改模板加验证码"这件事，必须先配 SMTP 才能做**——不是没保存、也不是改错模板，是平台不允许。
这也解释了为什么在配 SMTP 之前，邮件里永远只有链接、没有 6 位码。

### 2. 默认邮件服务只能发给项目团队成员的邮箱

官方文档写明的两个限制：

- **只发给项目团队成员邮箱**，其他地址报 `Email address not authorized`
- **每小时 2 封**

配了自定义 SMTP 之后：任意邮箱都能收，频率限制放宽到 30 封/小时（可在 Authentication → Rate Limits 调）。

### 3. 验证码位数默认是 8，界面是 6

项目默认 `mailer_otp_length = 8`，而登录界面是 6 格并在输满 6 位时自动提交——**不统一的话，用户输到第 6 位就会被提前提交然后报错**。已把服务端也设成 6。

### 4. `smtp_port` 必须传字符串

Management API 的 `smtp_port` 传数字会报 `Invalid input: expected string, received number`，要传 `"465"`。

### 5. 163/QQ 邮箱要用"授权码"而不是登录密码

在邮箱设置里开启 SMTP 服务后拿到的 16 位授权码，才是 SMTP 密码。

## 三、代码这边的设计

| 文件 | 作用 |
|---|---|
| `app/login/LoginForm.tsx` | 邮箱 + 6 位验证码两步流程；输满自动提交；错误翻译成中文 |
| `app/auth/confirm/route.ts` | 邮件链接回调：同时支持 `?code=`（PKCE）和 `?token_hash=`（任意浏览器可点） |
| `middleware.ts` | 兜底：带 `?code=` 的请求一律转交 `/auth/confirm` |
| `lib/supabase-server.ts` | 从 cookie 读会话 |

- **验证码类型自动兼容**：老用户 token 是 `email`，新用户注册是 `signup`。先按 `email` 验，不匹配自动再按 `signup` 验（失败不作废验证码）
- **登录即注册**：`shouldCreateUser: true`
- **链接不依赖 cookie**：模板里用的是 `?token_hash={{ .TokenHash }}`

## 四、验证清单

| 步骤 | 预期 |
|---|---|
| 打开 `https://find-moment.netlify.app/login` | 只有一个邮箱输入框，没有手机号 |
| 填邮箱 → 发送登录邮件 | 进入 6 格验证码页，60 秒重发倒计时 |
| 查收邮件 | 标题「你的 Find 登录验证码」，正文有一个大的 6 位数字 |
| 填 6 位码 | 自动提交 → 登录成功跳首页 |
| 点邮件里的链接 | 也能直接登录（换浏览器/手机也有效） |
| 用另一个邮箱试 | 应该同样能收到（这是配 SMTP 的意义） |
| 18-30 岁之外 | 填资料时被拦截 |

## 五、登录后

```
/login 邮箱 → 收码
   ↓ 填码 或 点链接
/auth/confirm 建立会话
   ↓
/profile 填资料（昵称 / 头像 / 城市 / 生日）
   ↓ 生日不在 18-30 岁 → 拦截
   ↓
/ 首页：说需求 → AI 解析 → 确认 → 匹配 → 临时对话
```

## 六、要换发件邮箱时

改 `scripts/supabase-setup-smtp.mjs` 里的 `MAIL` 和 `smtp_host`（QQ 是 `smtp.qq.com`），用新的授权码重跑一遍即可。
