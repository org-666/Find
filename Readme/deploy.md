# Find · 部署（Netlify + GitHub Actions）

**线上地址：https://find-moment.netlify.app**

## 一、当前部署结构

```
你本地 push 到 GitHub (org-666/Find, main)
        ↓
GitHub Actions (.github/workflows/deploy.yml)
        ↓  npm ci → npx netlify-cli deploy --build --prod
Netlify 站点 find-moment
        ↓
https://find-moment.netlify.app
```

**每次 push 到 main 都会自动重新部署**，不用手动做任何事。想看构建日志：GitHub 仓库页 → **Actions** 标签页。（Netlify 后台的 Deploys 页也能看到结果。）

## 二、为什么不用 Vercel

architecture.md 里原计划是 Vercel，但**在国内不可用**：

```
vercel.app                 → 173.244.209.150 / 199.96.59.61  ← Facebook 的 IP 段（DNS 投毒）
test-deploy-check.vercel.app → 69.63.184.30                  ← 同样是 Facebook 的 IP
TCP 443                      → 连接超时
```

部署上去你自己都打不开，用户更打不开。实测 Netlify 的域名正常可达（AWS 新加坡节点）。

## 三、为什么用 GitHub Actions 而不是 Netlify 的 Git 集成

试过三种方式，只有第三种走得通：

| 方式 | 结果 |
|---|---|
| Netlify 后台连仓库 | 需要浏览器 OAuth 授权 Netlify 的 GitHub App，命令行替代不了 |
| 纯 API 接仓库 | `public_repo` 是只读字段写不进去，`installation_id` 和 `deploy_key_id` 都是 null，Netlify 只会用 SSH 克隆 → `Host key verification failed`。改公开仓库、断开重接都一样 |
| **GitHub Actions + CLI 上传**（现用） | ✅ 绕开 Netlify 的 Git 集成，构建在 GitHub 服务器上跑，产物通过 API 上传 |

## 四、需要配置的东西

### GitHub 仓库密钥（Settings → Secrets and variables → Actions）

| 名字 | 值 |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify 的 Personal Access Token（Account → Applications → Personal access tokens） |
| `NETLIFY_SITE_ID` | `86608498-0e63-4a84-a774-9f5c948cba19` |

仓库是**公开**的，所以 token 只能放 Secrets，不能写进代码。要换 token 就在 Netlify revoke 旧的、生成新的、更新这个密钥。

### Netlify 站点环境变量

在站点设置里（不是 GitHub 密钥）：

| 名字 | 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 云端 Supabase 项目地址 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 可发布密钥（`sb_publishable_...`） |

这两个是**构建时**注入的（`NEXT_PUBLIC_` 前缀会被打进浏览器包），所以改完必须重新部署才生效。

### Supabase 后台（部署后必须改，否则邮件登录会跳回 localhost）

Authentication → URL Configuration：

- **Site URL**：`https://find-moment.netlify.app`
- **Redirect URLs**：加上 `https://find-moment.netlify.app/**`（本地地址可以留着方便调试）

## 五、本地相关的命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（需要先 `npm run db:start` 起数据库，或直接用云端） |
| `npm run build` | 生产构建（本地验证） |
| `npm run check:db` | 检查云端 Supabase：表、存储桶、登录方式开关 |
| `npm run sql:bundle` | 把迁移文件拼成一份一次性建表脚本（贴到 Supabase SQL Editor） |
| `node scripts/netlify-latest.mjs` | 看 Netlify 上最新一次部署的状态 |

## 六、踩过的坑（避免重复踩）

1. **vercel.app 在国内被 DNS 污染** —— 选平台前先实测目标域名
2. **Netlify CLI 装不上** —— npm 跑安装脚本时 `spawn EPERM`（DSH 沙箱挡进程派生）。放到 GitHub Actions 的 Linux 环境里跑就没这问题
3. **`NEXT_PUBLIC_` 变量是构建时注入的** —— 在 Netlify 改完环境变量必须重新部署，否则前端还是旧的
4. **私有仓库 + 纯 API 接 Netlify = 死路** —— Netlify 的 Git 集成绕不开浏览器 OAuth
