# 统一错误码体系与唯一投影入口（Unified Error Codes & Projection）

- **状态**：Proposed（待评审落地）；**素材域切片已落地**（2026-09-09，见文末「落地记录」）
- **日期**：2026-09-08
- **决策者**：李小强（经「优化整个错误码体系优雅统一」确认）
- **关联工单**：IKDZGM（错误码四套体系统一）
- **上游决策**：[ADR-0078 生成任务失败消息体统一](0078-generation-error-message-unification.md)（一期 + 二期，仅覆盖生成域）

## 背景

ADR-0078 只统一了**生成域**的错误码（28 个字符串码 + 数值码 1001-1028 + `messageFor()` 唯一文案）。但全库仍有 **6 套互不统一**的错误表达，其中部分是"无码裸中文"，是"失败无法定位"的最深来源。

### 现状全表（6 套）

| # | 体系 | 代表文件 | 表达方式 | 信封 |
|---|---|---|---|---|
| ① | 生成域 | `jobs/error-codes.ts` + `contracts/generation-error-codes.ts` | 枚举常量 + 数值码 + `messageFor()` | `{code,msg,data}` |
| ② | 账号域 | `account/change-password-error.ts` `projectAccountError()` | 正则从上游文案**猜**码 → `{code,message}` | `{code,msg,data}` |
| ③ | 鉴权/上游 | `errors/auth-error.ts` `toAuthError()` | HTTP 状态码 → 中文 Map | `{code,msg,data}` |
| ④ | 上游透传 | `errors/upstream-error.ts` `toUpstreamError()` | 状态码透传 + 502 兜底 | `{code,msg,data}` |
| ⑤ | 管理端 | `errors/admin-error.ts` `toAdminError()` | 状态码裁剪 | `{success:false,error}` |
| ⑥ | 裸中文 | 全库 **35 处** `fail(400,"中文")` | **无错误码**，写死中文 | `{code,msg,data}` 但 code=400 无语义 |

### 核心问题

1. **⑥ 35 处裸中文是最大乱源**：`fail(400,"SKILL.md 格式不合法")` 这类调用**没有错误码**，前端拿到 `code:400` 无法分支、排查无法定位（只能靠 msg 猜）。这是"失败不知道为啥失败"（IKDZGM 新增需求）的真正痛点。
2. **两套信封并存**：产品端 `{code,msg,data}` vs 管理端 `{success:false,error}`（`AllExceptionsFilter` 内可见）。同一后端两套契约。
3. **投影路径分散**：`fail()` 在 controller 里手动返回（走正常 return，不进异常过滤器）；而异常经 `AllExceptionsFilter` 兜底。**两套投影机制**。

### 现有可复用骨架（不推倒重来）

- `contracts/generation-error-codes.ts`：数值码表 + `errorCodeToNumeric()` + `messageFor` 的原型。
- `backend/libs/shared/jobs/public-error.ts`：`messageFor(code,type)`（29 case）+ `projectPublicError()`——**唯一投影的正确雏形**。
- `backend/libs/shared/jobs/jobs.service.ts`：投影调用点范例。
- `result.ts`：`{code,msg,data}` 信封 + 段位约定（4xx/5xx HTTP 语义、1xxxx 全局、1xxx 领域）。
- `backend/libs/infra/filters/all-exceptions.filter.ts`：全局兜底，真实"唯一投影"候选落点。

## 决策

### 1. 单一错误码表（Single Source of Truth）

建立**全库错误码总表**，段位约定升级（沿用 result.ts 并扩充）：

| 段位 | 含义 | 现状 |
|---|---|---|
| `4xx`/`5xx` | HTTP 语义错误（参数/未授权/资源不存在） | 保留 |
| `1xxx`（1000-1999） | **领域错误码**，每错一码 | 生成域已用 1001-1028 |
| `1xxxx`（100000+） | Java SystemCode 系全局业务码 | `result.ts` 常量 |
| `2xxx`（2000-2999） | **素材域**（上传、引用） | 2001-2012 已用（2026-09-09） |
| **新：`3xxx`** | 预留后续领域（账号/鉴权） | 待扩展 |

**码表唯一来源**：`packages/contracts/src/error-codes.ts`（新统一文件，re-export 生成域 + 汇总各领域 + 全局业务码），所有领域从这里取码，**不再各自定义**。

### 2. 唯一投影入口（Single Projection）

以 `AllExceptionsFilter` 为**唯一投影出入口**，规则：

- **业务错误**（领域码）：携带 `code`（数值领域码）的异常 → 投影为 `{code, data, msg}`，`msg` 由**码表唯一文案表**生成（不再由调用点写死中文）。
- **HTTP 语义错误**（参数畸形等）：`HttpException` → `{code: status, msg}`。
- **管理端**：统一为 `{code, msg, data}`（废弃 `{success:false,error}`），前端按同一信封解析——信封只留一套。
- **兜底**：未知异常 → 500 + 统一文案 + 日志（含堆栈）。

**改造路径**：
1. 新建统一码表（contracts）→ 2. 扩展 `AllExceptionsFilter` 为唯一投影 → 3. 各套 `toXxxError` 收敛到码表驱动的文案 → 4. **消灭 35 处裸中文**（改带错误码）。

### 3. 每错一码 + 文案唯一生成

沿 ADR-0078 二期原则：对外错误对象收敛为 `{code: 数值码, message: 中文}`；`message` 一律由唯一文案表生成，杜绝上游原文/英文 request id 透传。**新增错误码只改一处**（码表 + 文案表），不再跨 3 个文件。

### 4. 迁移顺序（分阶段，避免一次性大改）

| 阶段 | 内容 | 影响面 |
|---|---|---|
| 1 | 生成域：常量已去重（已落地），补"数值码表唯一 truth，文案从码表派生" | contracts + jobs |
| 2 | 账号域②：接入统一码表（`change-password-error.ts` 改用码表码 + 文案） | account |
| 3 | 鉴权③/上游④：`toAuthError`/`toUpstreamError` 文案改码表驱动 | errors |
| 4 | 信封统一⑤：管理端并入 `{code,msg,data}`，废弃 `{success,error}` | admin + filter |
| 5 | 消灭①-⑥裸中文：35 处 `fail(400,"中文")` 改带错误码 | 全库（skills/assets/generation/controllers） |
| 6 | 唯一投影：`AllExceptionsFilter` 收敛所有投影路径 | infra/filters |

## 被否方案

- **前端做文案映射 / 多端 i18n**：无多端需求，后端唯一生成最省事（同 ADR-0078 被否）。
- **推翻现有生成域骨架**：现有 `messageFor` + `errorCodeToNumeric` + `projectPublicError` 已是正确雏形，推广而非重写。
- **账号/上游/管理并成一个码表**：账号域可并（同构）；上游透传是"透传"职责、text 是 OpenAI 外部契约，**不强行并**（会破坏契约，明列入豁免）。

## 豁免（明确不并）

- `text/completions.ts` 的 `invalid_model`/`invalid_messages`/`model_not_in_whitelist`：**OpenAI 兼容外部契约**，前端按 OpenAI 错误形状解析，不入统一码表。
- `toUpstreamError`：职责是"透传 new-api 状态码"，不是业务错误码——状态码透传语义保留。

## 后果

- 新增 `contracts/error-codes.ts` 码表；`AllExceptionsFilter` 收敛为唯一投影；管理端信封统一。
- 35 处裸中文逐一改带错误码（改调用点，前端 `e.message` 消费不变，`code` 从 400 变具体领域码——**行为增强，前端可精确分支**）。
- DB `error.code` 仍存字符串规范码（只登记不动名，见 ADR-0078）；投影层负责字符串→数值映射。
- 前端无需改动即可继续消费 `msg`；新增 `code` 精确分支能力（前端后续消费）。

## 落地

分阶段（见迁移顺序）。每阶段按影响面测试；**阶段 5（35 处）是最大且最高风险**，建议先出码表 + 文案表，再逐文件迁移，每迁移完一个文件跑其测试。

## 落地记录

### 素材域切片（2026-09-09，工单见 PR 描述）

阶段 5（消灭裸中文）与阶段 6（唯一投影）在**素材域**先落一刀，作为其余领域的样板。

**触发它的那个 bug**：`POST /api/agent/assets/uploads/presign` 传一份 SVG，回的是
`HTTP 201` + body `{"code":400,"msg":"这个图片格式读不了…"}`——信封说失败，传输层说创建成功。
2026-09-08 测试站实测，`complete` 同样。本仓前端两条都判（`web/src/api/http.ts` 的
`!res.ok || !ok`）所以一直没暴露，但那是前端替后端兜的：任何只看状态码的客户端都会把拒绝
当成上传成功。

**根因就是本 ADR §核心问题 3 那句「两套投影机制」**，只是当时没量到它的具体后果。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `contracts/error-codes.ts` | 新增素材域 2xxx 码表。**HTTP 状态码并进码表**——一条错误一行，码/状态/文案同源；文案自动并入 `ERROR_CODES` 总表，不手抄第二份。新增 `httpStatusForCode()`，投影层唯一的换算处 |
| `contracts/domain-error.ts`（新） | `DomainError`（带数值领域码 + HTTP 状态）与 `assetError(name)`。文案默认取自码表，调用点不再写中文 |
| `infra/filters/all-exceptions.filter.ts` | 增加 `DomainError` 分支：`code` 用领域码、状态用码表给的那个。**新增本文件第一份单测**——它是整条链上唯一写 HTTP 状态码的地方，此前无人看守 |
| `shared/assets/upload.ts` | 12 处 `return fail(...)` → `throw`；`validateUploadInput` 改名 `assertUploadInput`（它不再返回，名字得说实话） |
| `shared/assets/project-assets.ts` | 9 处 `return fail(...)` → `throw` |
| `agent-assets.controller.ts` | 1 处 |

**新增的语义区分**（此前都压在一个无差别的 400 上）：

- `2003` 格式不支持（换个格式）与 `2010` 文件打不开（换个文件）是**两条不同的话**，合成一句会让人白白重传三次；单测钉住两者的码与文案都不许相同。
- `2006` 存储键不属于当前用户 → **403**，不是 400：那是越权，不是参数写错。
- `2007` 上传对象不存在 → **404**。
- `2008`/`2009`/`2012` 声明与实际不符 → **422**：请求合法，是内容不符语义。
- `2011` 对象存储未配置 → **503**：我们的部署问题，不是用户的请求问题。

**明确没动的**

- `NewApiError`：职责是透传上游状态码，本 ADR「豁免」一节已明列。agent 的内部端点
  （`internal-agent-assets` / `internal-agent-skills` / `agent-session-credits`）本来就 `throw`，
  状态码一直是对的，这次不动。
- 其余领域仍有约 110 处 `return fail(...)`。**它们的状态码依然是错的**，按本 ADR 的迁移顺序
  逐域跟进；素材域这一刀给出的是可照抄的形状，不是一次性全库改动。

**行为变化与兼容**

前端不需要改：`web/src/api/http.ts` 判的是 `!res.ok || !ok`，两条都认，报错文案仍从 body 取
（`readApiErrorMessage(body, res.status)`）。变化是拒绝时 HTTP 从 `201` 变成真实的 4xx/5xx，
且信封 `code` 从笼统的 400 变成可分支的领域码——ADR 原文称之为「行为增强」。
