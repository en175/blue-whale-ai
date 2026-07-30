# 积分体系集成流程：蓝鲸 ↔ new-api 网关

> 2026-07-28 方案讨论纪要。关联 IK4JX2 / IK39SS / IK39ZT。核心架构已收敛，待团队细聊确认后落地。
>
> **认证决策更新（2026-07-29）**：账户与 quota 使用 new-api 的方向继续有效；手机号/SMS、
> Java User 映射和 Java Gateway 兼容不再是实施前提。认证与运行时权威见
> [ADR-0062](adr/0062-new-api-account-center-and-quota-billing.md) 和
> [IK50GB 认证用户上下文设计](specs/2026-07-29-authenticated-user-context-design.md)。

## 状态

- **阶段**：方案讨论（grilling），核心决策已对齐方向，细节待确认
- **关联工单**：IK4JX2（架构讨论）/ IK39SS（积分体系父 PRD）/ IK39ZT（后台 PRD + 6 子工单 IK3A0B/F/J/Q/V/10）
- **参与**：李述（shuggg）+ Assistant

---

## 1. 背景与核心问题

IK39SS（积分充值消费体系）与 IK39ZT（积分支付后台）要落地，开工前两个地基决策未定：

1. **"积分"和网关 quota 是什么关系？** —— 积分体系建在网关侧还是蓝鲸侧？
2. **蓝鲸画布怎么调网关？** —— 终端用户身份要不要穿透到网关？

这两个决策影响 IK39SS/IK39ZT 一大批工单（账户/档位/定价/订单/用户管理）全部建在哪一侧。

---

## 2. 架构决策

### 2.1 调用模式：A（终端用户 = new-api user，身份穿透）✅

**选定**：每个蓝鲸终端用户在 new-api 有独立 user，身份穿透到网关。

| 维度 | A（选定） | B（聚合，弃） |
|---|---|---|
| 终端用户 ↔ 网关 | 每人一个 user | 蓝鲸一个账户代表所有人 |
| 余额 / 明细 | 网关原生独立 | 共享池，终端维度丢失 |
| new-api 能力 | 全复用（quota/logs/充值/tiered_expr） | 对终端用户闲置 |
| 双写 | 无 | 蓝鲸侧自建账本+双写 |

**理由**：A 让 new-api 的 quota/logs/充值/tiered_expr 全原生复用，零双写；B 把复杂度推给蓝鲸且闲置网关能力。

### 2.2 蓝鲸定位：不深度做用户系统

- 蓝鲸 Java/Spring Cloud 后端正改 Node
- 新版**不建深度用户系统，统一用 new-api 用户系统**
- 旧 Java `blue-whale-user-service`（独立 users 表 + JWT + 短信验证码 + 换绑）随 Java 废弃
- 蓝鲸 Node 退化为"画布编排 + 认证薄封装"

### 2.3 网关（new-api）定位

new-api = 蓝鲸的**账户中心 + AI 计费引擎**。终端用户直接是 new-api user，蓝鲸画布是 new-api 的业务前端之一。

### 2.4 现状链路（待改造）

```
当前：前端 → 蓝鲸gateway(8686,Java) → agent-service → new-api(3000) → 火山
                                          ↑
                              agent-service 聚合调用，终端用户身份未穿透
```

目标：终端用户身份直达 new-api，蓝鲸 Node 只做画布编排 + 透传身份。

---

## 3. 认证方案

### 3.1 凭证：A 方案（sk-xxx token），弃 C ✅

**选定**：注册自动建 sk-xxx token，蓝鲸 Node 用它调网关。

| | A（选定） | C（弃） |
|---|---|---|
| 蓝鲸 Node 拿到啥 | sk-xxx token（直接调 relay） | access_token（管理身份），代调 /api/token/ 查/建 sk-xxx |
| 前端传啥给 Node | sk-xxx | access_token |
| 凭证泄露风险 | 小（只能调 AI，消耗 quota，可撤销） | 大（access_token=管理身份，能改账户/查日志/删 token） |
| 用户前提 | 打开开关自动建 | access_token 默认无，要额外生成 |
| 复杂度 | 低 | 高（代管逻辑+多一跳） |

**比喻**：A 是给蓝鲸 Node 一把**钥匙**（只能开门调 AI）；C 是给一张**管理员工牌**（能管整栋楼）+ 还要多跑一趟去钥匙柜换钥匙。A 又简又安全。

> ⚠️ C 听起来"Node 控制力强"，实际只是把传的凭证从 sk-xxx 换成更危险的 access_token。且 C 若用"蓝鲸自己的总管理身份"代所有用户建 token，会退化成聚合模式（违背 2.1 的 A 模式）。

### 3.2 MVP：username/password（先不二开手机号）

- 第一版用 new-api 原生 username/password 注册/登录
- **登录页 UI 是蓝鲸自己的**，背后调 new-api `/api/user/login`（用户不跳网关界面、不感知 apikey）
- 手机号+短信**留后续**（C 端 UX，上线前必补）

### 3.3 手机号补缺口：附加式二开（后续）

new-api 现状（已查证）：登录用 username/password，验证码**只有邮件**（`SendEmailVerification`），`phone` 字段在 `controller/user.go` 里**零引用**（不参与认证）。

**附加式二开**（不改核心）：
- 新增 `PhoneLogin` / `PhoneRegister` / `SendSmsCode` controller
- **复用** `setupLogin`（session 签发是通用的，`controller/user.go:138`，接收 `*model.User` 即可）
- **复用** `VerifyCodeWithKey`（验证码存储/校验机制，邮件那套）
- 核心 `Login` / `Register` / `setupLogin` / middleware auth **全不动**
- 仅两处极小侵入：`User` struct 加 `Phone` 字段映射 + `loginMethodFromContext` 加一个 case
- DB `users.phone` 列已存在（蓝鲸 Java 旧版共享库写的），Go 补映射即对齐

---

## 4. 凭证流转链路

```
1. 注册：蓝鲸前端 → new-api /api/user/register
   env GENERATE_DEFAULT_TOKEN=true → 自动建 sk-xxx token
   ⚠️ 小改：响应返回 token key（现在不返回，user.go:296 只返回 success）

2. 登录：蓝鲸前端 → new-api /api/user/login
   ⚠️ 小改：setupLogin 响应查出用户当前 token 一起返回

3. 蓝鲸前端持 sk-xxx → 调蓝鲸 Node 时带（Authorization header）

4. 蓝鲸 Node 用 sk-xxx：
   - 调 relay /v1/* 做 AI 生成 → logs 按 user_id 自动隔离
   - 调 /api/log/token 查历史日志
```

**用户全程不感知 sk-xxx**（token 在前端 localStorage + 传 Node，UI 不暴露）。

---

## 5. 日志与查询（不用蓝鲸自建）

new-api 有现成接口 `/api/log/token`（`router/api-router.go:304`）：
- 鉴权：`TokenAuthReadOnly`（**sk-xxx 即可**）
- 查：这个 token 的调用记录
- 返回字段：`prompt_tokens` / `completion_tokens` / `quota` / `model_name` / `created_at`

蓝鲸 Node 用 sk-xxx 调它，直接拿到"上次花了多少 token、多少 quota"。**不用蓝鲸自己建日志系统，不用双写。**

| 接口 | 鉴权 | 查什么 | A 方案能用 |
|---|---|---|---|
| `/api/log/self` | UserAuth（session） | 用户维度所有日志 | ✗（要 session） |
| **`/api/log/token`** | **TokenAuthReadOnly（sk-xxx）** | **这个 token 的日志** | **✓ 现成** |
| `/api/task/self` | UserAuth | 异步任务详情 | ✗（要 session） |

> 边界：用户注册自动建 1 个 token，`/api/log/token` 查到 = 该用户全部日志 ✓。异步任务**状态详情**在 `tasks` 表（`/api/task/self`，要 session），但任务**扣费**通常也进 `logs`（`/api/log/token` 涵盖）。待确认。

---

## 6. quota → 积分（展示别名，零双写）

- 积分 = `users.quota × 系数`，**纯展示层换算**，后端不建积分表
- 单一真相源：`users.quota`（int，500000=$1，汇率 7）
- 系数全局配置（options 表），**上线前定死，日后不改**
- 蓝鲸前端封统一 `quotaToCredits` 工具，余额 / Dock 消耗 / 充值记录 / 消费记录全走它
- 充值：档位存 credits（用户感知），创建时换算 quota 缓存进档位；充值成功 `users.quota += 档位.quota_at_creation`
- 消费：relay 扣 quota（**零二开**），前端换算显示

---

## 7. sk-xxx 权限边界（代码查证）

### 能调（`TokenAuth` / `TokenAuthReadOnly` 路由）
- **所有 relay**：`/v1/chat/completions`、`/v1/images`、`/v1/video`、gemini、claude、mj、suno、kling、jimeng（`router/relay-router.go`、`router/video-router.go`）
- **查自己日志**：`/api/log/token`（`router/api-router.go:304`）
- **token 用量查询**：tokenUsageRoute（`router/api-router.go:250`）

### 不能调（要 session/access_token）
- 改用户资料（`/api/user/self` PUT）
- 用户维度日志（`/api/log/self`）
- 管理 token 增删改（`/api/token/*`）
- 充值（`/api/topup/*`）
- 任何管理/系统操作

### 校验逻辑（`middleware/auth.go:314`）
`ValidateUserToken(key)` → 注入 `user_id` 到上下文 → IP 限制 → 用户状态校验（禁用拒绝） → 用户分组。

### 安全结论
sk-xxx = **"调 AI + 查自己用量/日志"**。泄露最多消耗 quota（撤销重建即可），不能改账户、不能管 token、不能充值。最小权限，正好够蓝鲸用。

---

## 8. 落地步骤

### MVP（先跑通）
1. env：`GENERATE_DEFAULT_TOKEN=true`（注册自动建 sk-xxx token）
2. new-api 改 3 处响应（接口全现成，不开新接口）：
   - `Register` 响应返回 sk-xxx token key（`controller/user.go:296`）
   - `setupLogin` 响应返回 sk-xxx token key（`controller/user.go:138`）
   - `GetTokenUsage` 加字段返回用户余额 quota（`controller/token.go:118`，让 unlimited token 也能查准 `users.quota`）
3. 蓝鲸前端：登录页（username/password），持 token 传蓝鲸 Node
4. 蓝鲸 Node：用 sk-xxx 调 relay + `/api/log/token` 查日志 + `/api/usage/token/` 查余额
5. quota × 系数 → 前端显示积分

### 后续
1. 手机号 + 短信（附加式二开 new-api，见 3.3）
2. 充值档位 + 支付链路（IK39SS 充值工单）
3. 积分定价（tiered_expr，已验证参数化定价）
4. token 轮换 / 撤销机制
5. IK39ZT 后台模块（用户/订单/系统配置，基于 new-api users/topups/options）

---

## 9. 待决策 / 待确认

- [ ] **token 返回**：Register/setupLogin 响应加 token key（改响应体，10 行级）
- [ ] **蓝鲸前端登录入口**：直连 new-api `/api/user/login` 还是经蓝鲸 Node 代理（涉及跨域/session）
- [ ] **token 轮换**：sk-xxx 泄露怎么换新不影响用户
- [ ] **任务日志**：`/api/log/token` 是否涵盖异步视频任务（tasks 表）的扣费；任务状态详情是否需要
- [ ] **积分系数定值**（上线前定死）
- [ ] **蓝鲸 Node 持 token 方式**：前端传（A，token 在 localStorage）vs Node 终结（A+，token 不出 Node，前端只持 session）
- [ ] **网关界面开放性**：new-api default web 是否给终端用户看（当前结论：不给，蓝鲸前端做壳）

---

## 附 A：关键代码证据

| 事实 | 位置 |
|---|---|
| quota 余额字段 | `users.quota`（int，500000=$1，汇率 7） |
| 消费明细表 | `logs`（user_id / quota / prompt_tokens / completion_tokens） |
| session 签发（通用，可复用） | `controller/user.go:138` setupLogin |
| sk-xxx 查日志接口 | `router/api-router.go:304` `/api/log/token`（TokenAuthReadOnly） |
| sk-xxx 鉴权 | `middleware/auth.go:314` TokenAuth / `:241` TokenAuthReadOnly |
| 注册自动建 token 开关 | `common/init.go:155` GENERATE_DEFAULT_TOKEN（默认 **false**） |
| new-api 无手机号登录 | `controller/user.go` Login/Register 用 username；`phone` 字段零引用 |
| 验证码只有邮件 | `controller/misc.go:235` SendEmailVerification（无 SMS） |
| users 表已有 phone 列 | DB schema（蓝鲸 Java 旧版共享库写入，Go 未映射） |

---

## 附 B：与原 IK4JX2 议题的关系

IK4JX2 抛出的 4 个待决策项，本次 grilling 的结论：

| IK4JX2 议题 | 本次结论 |
|---|---|
| 蓝鲸现状怎么调网关 | 现状是聚合（agent-service 一个身份），**要改造成 A 模式**（终端用户身份穿透） |
| 网关定位（专属 vs 多客户） | 专属蓝鲸的账户中心 + 计费引擎 |
| 积分=quota 别名约束 | 接受（系数定死、赠送不可追溯、无差别池） |
| IK39ZT 工单归属 | 留在网关侧（用户管理/订单/系统配置基于 new-api users/topups/options） |

---

## 备注

- sk-xxx 权限基于代码 grep（权威，事实之源）。context7 MCP 本 session 未加载（工具未注册），文档印证待重启 Claude Code 后补充。
- 本文档是 grilling 讨论的阶段性固化，**非定稿**。团队细聊确认后转 ADR。
