# 统一错误码体系与唯一投影入口（Unified Error Codes & Projection）

- **状态**：Proposed（待评审落地）
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
| **新：`2xxx`/`3xxx`** | 预留后续领域（账号/鉴权/资产） | 待扩展 |

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
