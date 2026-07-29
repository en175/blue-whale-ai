# IK4YXG：Cloudflare Turnstile 机器人保护接入设计

> **状态**：设计草案（Design Draft）
> **工单**：IK4YXG
> **分支**：`feature/IK4YXG-机器人保护接入设计`
> **创建日期**：2026-07-29
> **结论**：暂不实现，前置条件就绪后再开工单

---

## 1. 问题陈述

### 1.1 目标

为 new-api 的登录、注册、找回密码、邮箱验证、签到入口接入 Cloudflare Turnstile 人机验证，防机器人撞库 / 批量注册。

### 1.2 现状：new-api 已内置，零代码改动

Turnstile 是 new-api 原生功能，后端中间件与路由挂载均已就绪，启用只需在后台填两个 key + 打开关。

**代码证据：**

| 位置 | 作用 |
|---|---|
| `blue_whale_api/middleware/turnstile-check.go:17` | `TurnstileCheck()` 中间件：取 token → POST `challenges.cloudflare.com/turnstile/v0/siteverify` 验签 → session 标记 |
| `blue_whale_api/router/api-router.go:42` | 邮箱验证 `/api/verification` 挂载 |
| `blue_whale_api/router/api-router.go:43` | 找回密码 `/api/user/reset` 挂载 |
| `blue_whale_api/router/api-router.go:72` | 注册 `/api/user/register` 挂载 |
| `blue_whale_api/router/api-router.go:73` | 登录 `/api/user/login` 挂载 |
| `blue_whale_api/router/api-router.go:124` | 签到 `/api/user/checkin` 挂载 |
| `blue_whale_api/controller/option.go:201-205` | 启用校验：`TurnstileCheckEnabled=true` 且 Site Key 为空 → 报错拒绝启用 |
| `blue_whale_api/common/constants.go:94,143-144` | 三个配置项默认值：`TurnstileCheckEnabled=false` / `TurnstileSiteKey=""` / `TurnstileSecretKey=""` |

**配置项（存 `options` 表）：**

- `TurnstileCheckEnabled`（bool）— 总开关
- `TurnstileSiteKey`（string）— 站点密钥，前端 widget 用
- `TurnstileSecretKey`（string）— 密钥，后端验签用

**前端：** default 主题 `web/default/src/features/system-settings/auth/bot-protection-section.tsx`（「设置 → 系统设置 → 登录与注册 → 机器人保护」区块）；classic 主题 `web/classic/src/components/settings/SystemSetting.jsx:1662`（「配置 Turnstile」表单段）。

---

## 2. 误区澄清（接入前必须理清的三件事）

| 误区 | 事实 |
|---|---|
| 要把域名 DNS 托管到 Cloudflare 才能用 Turnstile | ❌ **不需要**。Turnstile 是独立产品，与 DNS 托管解耦。域名解析留原服务商（DNSPod / 阿里云），只在 CF Turnstile 后台 Allowed Hostnames 加域名即可。 |
| 纯 IP 也能用 | ❌ **不稳定**。Turnstile 按浏览器 `location.hostname` 校验，纯 IP 虽勉强算 hostname 但验证常失败。**实际使用必须域名**。 |
| 备案才能解析域名 | ❌ **解析与备案无关**。DNS 解析 = 域名→IP 映射，加 A 记录立刻生效，备不备案都能解析。备案管的是「大陆服务器公网 HTTP 访问」，不是 DNS。 |

---

## 3. 落地被两个前置条件卡住

### 3.1 ICP 备案（大陆服务器）

- prod 部署在**火山引擎北京（大陆服务器）**。
- 大陆云厂商 / 运营商按《互联网信息服务管理办法》核验备案，按 **Host / SNI 头** 识别未备案域名，拦截 80/443。
- 未备案 → 域名能解析，但浏览器访问大陆服务器上的域名会被拦，用户打不开页面，widget 再配也没用。
- 备案周期 **1-3 周**（火山引擎走工信部，主体备案 + 网站备案）。

### 3.2 challenges.cloudflare.com 大陆可达性

- Turnstile 前端 widget 从 `challenges.cloudflare.com` 加载，后端验签也调该域。
- 该域在**大陆网络下访问不稳定、偶发被墙**。
- **备案解决不了这个**：CF 域名在海外，归 GFW 管辖，与 ICP 无关。
- 风险：widget 加载失败 → 用户卡在登录页进不去 → 对大陆用户是**负优化**。
- **必须上线前用大陆流量（手机热点）实测** widget 能否正常渲染。

---

## 4. 正确落地顺序

```
1. ICP 备案（1-3 周）         ← 卡点 A
2. 域名 A 记录解析到服务器     ← 备案下来才能公网用
3. nginx + HTTPS（SSL 证书）   ← 服务器对外用域名+证书服务
4. Cloudflare Turnstile        ← 填 2 个 key + 打开关，5 分钟
```

Turnstile 是**最后一步**。前序（备案 → 解析 → HTTPS）属**运维 / 基础设施范畴**，不是 new-api 应用层改动。

---

## 5. 决策：暂不实现

本 issue 仅落盘设计，**不写代码、不接入**。

**实现触发条件（两关都过才开工单）：**

1. ✅ ICP 备案完成，域名可公网访问大陆服务器
2. ✅ 大陆流量实测 `challenges.cloudflare.com` 可达性通过（widget 正常渲染）

若第 2 关不过（CF 在大陆不可靠），则放弃 Turnstile，改用国内人机验证方案（如腾讯云验证码 / 极验 / 自研）。

---

## 6. 接入步骤（前置就绪后执行）

### 6.1 Cloudflare 侧

1. 用**公司 CF 账号**（非个人邮箱，防离职锁死）登录 Cloudflare → Turnstile。
2. 新建 widget，Widget Mode 按需（Managed / Non-Interactive / Invisible）。
3. Allowed Hostnames 填 new-api 公网域名。
4. 拿到 **Site Key** + **Secret Key**，存公司密码库。

### 6.2 new-api 侧

1. 管理员登录 → 设置 → 系统设置 → 登录与注册 → 机器人保护。
2. 填 Site Key + Secret Key。
3. 打开「启用 Turnstile」开关（**无 Site Key 时开关打不开**，见 `controller/option.go:201`）。
4. 保存。

### 6.3 联调验证（用 CF 官方测试 key）

备案 / 域名就绪前，可用测试 key 先验集成链路：

| 用途 | Site Key | Secret Key |
|---|---|---|
| 永远通过（验渲染+后端验签逻辑） | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| 永远失败（验拦截路径） | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

本地 dev 或内网测通 widget 渲染 + 后端 `siteverify` 链路即可，不碰公网。

---

## 7. 待确认事项

1. prod 最终用哪个域名？（影响 CF Allowed Hostnames 与备案主体）
2. 火山引擎北京是否对该域名强制要求备案才能放行 80/443？（需联系厂商确认拦截策略，一般大陆厂商都强制）
3. `challenges.cloudflare.com` 在目标用户网络（大陆）实际可达性如何？（上线前手机热点实测）
4. 是否有替代的国内人机验证方案偏好？（CF 不可靠时的 Plan B）

---

## 8. 不做什么

- **不在本 issue 写代码 / 接入 Turnstile**（仅设计文档）
- **不托管域名 DNS 到 Cloudflare**（Turnstile 与 DNS 解耦，无需）
- **不碰 nginx / SSL 配置**（那是第 3 步运维活，独立工单）
- **不在备案 / CF 可达性未确认前给 prod 填真实 key**（填了用户也访问不了，且可能负优化）
