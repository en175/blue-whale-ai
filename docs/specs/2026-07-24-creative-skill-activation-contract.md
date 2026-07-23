# Creative Skill 激活跨服务契约（选择、候选、接纳与按需读取）

- **状态**：Accepted for implementation
- **契约版本**：1
- **关联工单**：[冻结 Creative Skill 激活跨服务契约](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3NHU)
- **下游消费**：[接通 Creative Skill Use/auto、按需激活与版本固定](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK2D8P)
- **前置契约**：[Runtime Agent Bundle 领域契约与资源规范](2026-07-20-runtime-agent-bundle-contract.md)、[ADR-0041 同族工单串行与契约先行](../adr/0041-sibling-issues-serial-contract-first.md)、[ADR-0042 契约措辞与已实现行为对齐](../adr/0042-runtime-bundle-contract-wording-alignment.md)
- **机器可读契约**：[creative-skill-activation.schema.json](creative-skill-activation.schema.json)（Draft 2020-12）
- **示例**：[fixtures/creative-skill-activation/](fixtures/creative-skill-activation/)（`manifest.json` 索引，Java / Python / TypeScript 三端一致性测试共同消费）

本文冻结 Web → Java、Java → Worker、Worker → Java 三个方向上 Creative Skill 选择与激活的
跨进程字段：一次性 `Use` 如何随创建目标 AgentRun 的消息下达、`auto` 候选如何随 RunWork
冻结、Worker 如何提议、Java 如何幂等接纳并固定，以及激活后正文与引用资源如何按需读取。
它只定义字段、时序、幂等与错误分类，不定义数据库表、选择算法、正文装载实现或 UI；
Creative Skill 独立于 Runtime Agent Bundle，其资源形态不再是 Bundle schema 的一部分。

## 1. 术语与身份

1. **CreativeSkill**：User 可见的版本化创作方法，稳定身份 `creative_skill_id`
   （`^[a-z][a-z0-9_]{2,79}$`）。**CreativeSkillVersion**：其下不可变版本，系统身份
   `creative_skill_version_id`（同模式），展示版本 `display_version` 为 SemVer，仅作
   人类可读标签，不能替代系统身份。
2. **摘要**：`resource_digest` 与 `content_digest` 均为 `sha256:<64 位小写十六进制>`，
   计算对象是发布的确切字节；摘要不同即为不同内容。
3. **CreativeSkillActivation（激活记录）**：一次激活的不可变事实，含 Skill 与版本身份、
   `source`（`forced_use` / `auto`）、结构化 `reason` 与 `resource_digest`。
4. **AutoCreativeSkillCandidate（自动候选）**：Run 创建时冻结的可自动激活候选，含 Skill 与
   版本身份、`name`、`description`、`display_version`、`resource_digest`，**不含正文**。
5. 所有 wire 字段为 snake_case，Java 经全局 SNAKE_CASE 策略输出；三端载荷同形，由
   fixtures 一致性测试锁定。

## 2. 消息命令扩展（Web → Java）

公开消息命令 `POST /api/projects/{projectId}/conversation/messages`
（`AcceptConversationMessageRequest`）新增一个可空字段：

| 字段 | 约束 | 语义 |
|---|---|---|
| `forced_creative_skill_id` | 可缺省、可空 CreativeSkillId | 一次性 `Use`：为该消息创建的目标 AgentRun 强制激活该 Skill；缺省 / `null` 表示不强制 |

- `Use` 只携带稳定 Skill ID，**不携带版本**；版本由 Java 在创建目标 Run 时解析当前发布
  版本并固定。
- 该字段进入消息命令的幂等哈希：同一 `Idempotency-Key` 下 `forced_creative_skill_id`
  不同即为不同请求，按既有规则返回 `IDEMPOTENCY_KEY_REUSED`。消息与目标 Run 的幂等创建
  仍由 `client_message_id` 与 HTTP 头 `Idempotency-Key` 保证，本契约不改变该机制。

## 3. RunWork 字段（Java → Worker）

RunWork 下发固定两个 Creative Skill 字段，**始终为数组**（不得缺省为 `null`）：

| 字段 | 约束 | 语义 |
|---|---|---|
| `auto_creative_skill_candidates` | `AutoCreativeSkillCandidate` 数组，可为空 | Run 创建时冻结的 `auto` 候选；空数组 = 无匹配 |
| `activated_creative_skill_versions` | `CreativeSkillActivation` 数组，**最多一项** | 兼容名称下的 0/1 单例数组：本 Run 已固定的激活记录 |

- 单 Run 最多激活一个 CreativeSkillVersion；`activated_creative_skill_versions` 既是
  Run pin 的 wire 投影，也与既有 Run pin 列同名兼容，基数恒为 0 或 1。
- 候选在 Run 创建时冻结，运行中不随 Skill 库发布新版而漂移；Worker 只可从候选中提议，
  不得发明候选外的 Skill 或版本。
- 这两个 pin 字段随 RunWork 下发时已由 Java 权威记录，Worker commit **不回传**（与
  ADR-0042 D2 的 pin 不回传规则一致）。

## 4. 激活时序

### 4.1 forced_use（用户 `Use`）

1. User 点击某 Creative Skill 的 `Use`；Web 在创建目标 AgentRun 的用户消息上携带
   `forced_creative_skill_id`。
2. Java 幂等接纳消息命令，解析该 Skill 当前发布版本；解析失败（Skill 不可用、版本
   不可用或该消息不允许选择）→ 拒绝命令，**不得静默降级为基础生成**。
3. Java 在创建目标 Run 的同一事务内，把
   `CreativeSkillActivation{source=forced_use, reason={type=user_use}}` 原子固定进
   `activated_creative_skill_versions`；RunWork 下发时该数组即含此单例。
4. 该 Run 之后任何激活请求（forced 或 auto）均返回 `CREATIVE_SKILL_ALREADY_ACTIVATED`。

### 4.2 auto（Worker 提议 / Java 接纳）

1. 消息命令未携带 `forced_creative_skill_id` 时，Java 在创建 Run 时计算并冻结
   `auto_creative_skill_candidates`（选择算法不在本契约内）。
2. Worker 运行中至多提议一个候选版本：发送 §5 的激活命令，携带 `idempotency_key`、
   `expected_run_version`、候选版本身份与 `agent_match` 理由。
3. Java 校验：幂等键、Run version、候选成员（版本必须属于已冻结候选）、Run 尚未激活。
   全部通过后在同一事务内原子固定 `CreativeSkillActivation{source=auto}` 并返回接纳
   响应；**固定完成前不得放行正文或引用资源读取**。
4. 空候选（无匹配）是唯一允许基础生成的路径：Worker 不发起激活命令，正常生成。
5. 候选计算、提议传输、接纳校验或摘要比对任一故障均 fail closed：不得静默降级、不得
   自行换版本、不得跳过摘要校验。

### 4.3 理由对象（reason）

`reason` 是判别式结构，`type` 必须与 `source` 一致（schema 以 `if/then` 锁定）：

| source | reason | 约束 |
|---|---|---|
| `forced_use` | `{"type": "user_use"}` | 封闭对象，**禁止自由文本**；用户意图由消息本身承载 |
| `auto` | `{"type": "agent_match", "detail": {...}}` | `detail` 必填；`matched_fields` 为非空去重数组，取值枚举 `conversation_messages` / `conversation_summary` / `canvas_nodes` / `project_metadata` |

### 4.4 幂等重试

- 同一 `idempotency_key` + 相同载荷重试激活命令 → 回放首次接纳结果，不产生二次副作用
  （回放载荷与首次接纳响应逐字节一致，见 §9 的 `activation-response-replay` 示例）。
- 同一 `idempotency_key` + 不同载荷 → `IDEMPOTENCY_KEY_REUSED`。
- `expected_run_version` 与当前 Run version 不符、租约 / fencing 失效 → `AGENT_RUN_CONFLICT`。

## 5. 自动激活命令（Worker → Java）

```text
POST /internal/agent-runs/{runId}/creative-skill-activations
```

请求体（snake_case JSON，schema `#/$defs/ActivateCreativeSkillRequest`）：

| 字段 | 约束 | 语义 |
|---|---|---|
| `idempotency_key` | 必填，1–64 字符 | 激活操作幂等键 |
| `expected_run_version` | 必填，整数 ≥1 | Worker 持有的 Run version，乐观并发 |
| `creative_skill_id` | 必填 | 候选的稳定 Skill ID |
| `creative_skill_version_id` | 必填 | 候选的不可变版本 ID，必须属于已冻结候选 |
| `reason` | 必填 `AutoMatchReason` | `agent_match` 结构化理由 |

接纳响应（`#/$defs/ActivateCreativeSkillResponse`）：`accepted`（恒 `true`）、`activation`
（已固定的完整激活记录，Java 回写权威 `resource_digest`）、`run_version`（固定后的新
Run version）。拒绝走标准错误通道，错误码见 §8。

## 6. 已激活正文与引用资源读取（Worker → Java）

激活固定后，正文与引用资源按需读取，**只按 Run 已固定版本返回**，各携带内容摘要：

- 正文读取响应（`#/$defs/CreativeSkillBodyResponse`）：`creative_skill_id` /
  `creative_skill_version_id` / `media_type`（恒 `text/markdown`）/ `body` /
  `content_digest`。
- 单个引用资源读取响应（`#/$defs/CreativeSkillReferenceResourceResponse`）：
  `creative_skill_id` / `creative_skill_version_id` / `resource_path`（POSIX 相对路径，
  规则同 Bundle 契约 §3.2）/ `media_type` / `content` / `content_digest`。

Worker 读取后必须校验 `content_digest` 与固定摘要一致；字节缺失或摘要不符均 fail
closed（§8），不得使用缓存替代品或降级内容。

## 7. Worker 推荐查询（冻结现有路由）

```text
GET /internal/agent-runs/{runId}/creative-skills
```

- 路由保留；数据源从 Runtime Bundle 快照改为 Java Skill Library（迁移实现归 IK2D8P，
  本契约只冻结目标形状）。
- 响应（`#/$defs/RunCreativeSkillRecommendationsResponse`）是数组，只列出**不属于本 Run
  `auto` 候选**、但可向用户推荐的 Skill；每项固定为 `creative_skill_id` / `name` /
  `description` / `activation_eligibility`（恒 `requires_user_use`），封闭对象。
- 响应**不得携带版本 ID、摘要或正文**，也不构成自动激活授权；用户点击 `Use` 后由创建
  目标新 Run 的消息按 §2 重新解析版本。
- 文档 schema 与 Java 运行时装载的 schema 副本同源唯一：`docs/specs/` 为唯一副本，
  Java 构建期拷入 classpath，同形由 fixtures 一致性测试锁定。

## 8. 规范化错误码

错误码是稳定契约值；新增取值必须先修订本文档。`AGENT_RUN_CONFLICT` 与
`IDEMPOTENCY_KEY_REUSED` 复用既有业务码，其余为本契约新增编号（实现归 IK2D8P）。

| 错误码 | HTTP / 业务码 | 场景 |
|---|---|---|
| `CREATIVE_SKILL_UNAVAILABLE` | 404 / 100306 | forced 或 auto 指向的 Skill 不存在、已退役或对当前 User / Project 不可见 |
| `CREATIVE_SKILL_VERSION_UNAVAILABLE` | 404 / 100307 | 指定版本不存在或不再可读；激活路径 fail closed，不换版本 |
| `CREATIVE_SKILL_SELECTION_NOT_ALLOWED` | 409 / 100308 | 该消息 / 目标 Run 不允许携带 `forced_creative_skill_id` |
| `CREATIVE_SKILL_NOT_A_CANDIDATE` | 409 / 100309 | 激活请求的版本不属于本 Run 已冻结的 `auto` 候选 |
| `CREATIVE_SKILL_ALREADY_ACTIVATED` | 409 / 100310 | Run 已存在激活记录，拒绝第二次激活 |
| `AGENT_RUN_CONFLICT` | 409 / 100303（复用） | `expected_run_version` 冲突、租约 / fencing 失效、Run 已终态 |
| `IDEMPOTENCY_KEY_REUSED` | 409 / 100302（复用） | 同幂等键不同载荷 |
| `CREATIVE_SKILL_CONTENT_MISSING` | 500 / 100311 | 已固定版本的正文或引用资源字节缺失，fail closed |
| `CREATIVE_SKILL_DIGEST_MISMATCH` | 500 / 100312 | 读取内容摘要与固定摘要不符，fail closed |

只有「无匹配」（空候选）允许正常基础生成；上表中任何错误都不得被吞掉后降级为基础生成。

错误载荷为封闭对象 `{code, message}`（schema `#/$defs/CreativeSkillActivationError`），
`code` 取值被 schema 枚举锁定为上表九项（`#/$defs/CreativeSkillActivationErrorCode`），
`message` 为人类可读说明（1–500 字符），不进入程序化判定。

## 9. 示例索引

合法与非法示例均为机器可校验 fixture，三端一致性测试逐条消费（索引见
[manifest.json](fixtures/creative-skill-activation/manifest.json)）：

- 合法：forced `Use` 消息命令（含键缺省与显式 `null` 两种不强制形态）、空候选 RunWork、
  `auto` 候选 RunWork、forced 激活单例 RunWork、`auto` 激活命令、接纳响应、幂等重试回放
  （`activation-response-replay`，与首次接纳响应逐字节一致）、正文读取、单个引用资源
  读取、推荐查询响应、fail-closed 错误载荷（`error-not-a-candidate` /
  `error-digest-mismatch` / `error-already-activated`）。
- 非法：超过单项的激活数组（`second-activation`，数组两项被 `maxItems:1` 拒绝）、
  forced 理由带自由文本、`auto` 理由缺 `detail`、无效 digest、候选携带正文（额外字段）、
  推荐项携带版本 ID、`source` 与 `reason.type` 不一致。已激活 Run 上的第二次激活请求属于
  Java 运行时校验（JSON Schema 无法表达），其规范化拒绝以 `error-already-activated`
  错误载荷示例冻结。

## 10. 明确不包含

- 数据库迁移、CreativeSkillVersion 持久化与 Skill seed 回填。
- Java 激活服务、Worker 选择逻辑、正文装载与 Web UI 实现（均归 IK2D8P）。
- 多 Skill 组合、运行中切换 Skill、点击 `Use` 自动 `Add` 或启用 `auto`。
