# Find · 登录（邮箱验证码）

> 模块 A 的其他部分（资料、18-30 年龄门槛）见 `setup-module-a.md`。

## 一、为什么砍掉手机号

原来的设计是「手机号 + 短信验证码」。实际接云端时发现这条路走不通：

- Supabase 云端**必须**接一个短信服务商（Twilio / MessageBird / Vonage / TextLocal）才能开 Phone 登录
- 只有本地开发（`config.toml` 的 `[auth.sms.test_otp]`）才有免费固定验证码，云端没有
- Twilio 要绑卡，发到国内手机号还受短信监管限制，可能根本收不到

邮箱验证码不需要任何付费通道，所以**只保留邮箱**。代码里手机号相关的部分已全部删除。

## 二、当前状态：能用，但有硬限制

现在走的是 Supabase **内置**邮件服务，它有两个官方写明的限制：

| 限制 | 具体表现 |
|---|---|
| **只能发给项目团队成员的邮箱** | 其他地址一律报 `Email address not authorized` |
| **每小时 2 封** | 超过就报频率限制 |

也就是说：**只有用你注册 Supabase 那个邮箱才能登录成功**。要让任意用户都能注册，必须配自己的 SMTP（下一节）。

## 三、配免费 SMTP（配完就能发给任意邮箱）

### 方案 1：QQ 邮箱（国内最省事，完全免费）

1. 登录 QQ 邮箱 → **设置 → 账户** → 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」
2. 开启 **SMTP 服务**（需要短信验证），会拿到一串 **16 位授权码**——注意这不是你的 QQ 密码
3. 打开 Supabase → **Authentication → Emails → SMTP Settings** → 打开 **Enable Custom SMTP**
4. 填：

   | 字段 | 值 |
   |---|---|
   | Host | `smtp.qq.com` |
   | Port | `465` |
   | Username | 你的 QQ 邮箱（如 `12345@qq.com`） |
   | Password | 上面那串**授权码** |
   | Sender email | 你的 QQ 邮箱 |
   | Sender name | `Find` |

5. 保存。之后任意邮箱都能收到验证码了。

> QQ 邮箱有每日发信上限（几百封），个人项目足够。

### 方案 2：163 邮箱
`Host: smtp.163.com`、`Port: 465`，同样需要先在 163 邮箱设置里开启 SMTP 并拿授权码。

### 方案 3：Brevo（国际服务，免费 300 封/天）
`Host: smtp-relay.brevo.com`、`Port: 587`，注册后要验证一个发件邮箱，不需要自己有域名。

### 方案 4：Resend（免费 3000 封/月）
需要自己有个域名并验证，才能发给任意邮箱；没有域名时只能发给自己。不推荐给现在这个阶段。

**配完 SMTP 之后**：Authentication → Rate Limits 里可以把邮件频率限制从默认的 30 封/小时调高。

## 四、还要在后台确认的配置

1. **Authentication → Sign In / Providers → Email** 打开（默认就是开的）
2. **Authentication → URL Configuration**
   - Site URL：`http://localhost:3000`
   - Redirect URLs：加上 `http://localhost:3000/**`
3. **邮件模板要带验证码**（默认模板只有链接，没有数字码）。改 **Confirm signup** 和 **Magic Link** 两个模板：

   ```html
   <h2>你的登录验证码</h2>

   <p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">{{ .Token }}</p>

   <p>把这 6 位数字填到 Find 的验证码框里就能登录，5 分钟内有效。</p>

   <p style="color:#888888;font-size:12px;margin-top:28px">
     在电脑上点的可以用这个链接直接登录：<br />
     <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">直接登录</a>
   </p>
   ```

## 五、代码这边做了什么

| 文件 | 作用 |
|---|---|
| `app/login/LoginForm.tsx` | 邮箱 + 验证码两步流程；输满 6 位自动提交；错误信息翻译成人话 |
| `app/auth/confirm/route.ts` | 邮件里链接的回调：支持 `?code=`（PKCE）和 `?token_hash=`（任意浏览器可点）两种形式 |
| `middleware.ts` | 兜底：邮件链接不管落在哪个路径，只要带 `?code=` 就转交给 `/auth/confirm` |
| `lib/supabase-server.ts` | 从 cookie 读会话，供服务端组件判断登录态 |

几个实现细节：

- **验证码 type 自动兼容**：老用户登录的 token 类型是 `email`，新用户注册是 `signup`。代码先按 `email` 验，不匹配自动再按 `signup` 验一次（校验失败不会作废验证码，重试是安全的）。
- **邮件链接不依赖浏览器 cookie**：模板里用的是 `?token_hash={{ .TokenHash }}` 而不是 Supabase 中转链接，所以**在手机、在别的浏览器点都能登录成功**。
- **登录即注册**：`shouldCreateUser: true`，第一次登录就是注册，不需要单独的注册流程。

## 六、登录后的流程

```
/login 输入邮箱 → 收邮件
   ↓ 填 6 位码 或 点链接
/auth/confirm 建立会话（写 cookie）
   ↓
/profile 填资料（昵称 / 头像 / 城市 / 生日）
   ↓ 生日不在 18-30 岁 → 拦截，写不进库
   ↓
/ 首页：说需求 → AI 解析 → 确认 → 匹配 → 临时对话
```

## 七、验证清单

| 步骤 | 预期 |
|---|---|
| 打开 `/login`，填一个邮箱 | 只有邮箱一个输入框，没有手机号了 |
| 点「发送登录邮件」 | 进入验证码页，60 秒重发倒计时 |
| 邮件里应包含 | 6 位数字（前提：模板改过） |
| 填入 6 位码 | 自动提交，登录成功跳首页 |
| 点邮件里的链接 | 直接登录（换浏览器也行） |
| 乱填邮箱 | 前端就拦住，不发请求 |
| 链接失败 | 回到 `/login` 并提示用验证码登录 |
