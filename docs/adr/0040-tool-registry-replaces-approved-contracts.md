# ADR-0040：工具注册表取代 approved-tool-contracts 配置形态

- **状态**：Accepted
- **日期**：2026-07-21
- **关联工单**：[建立平台工具注册表并接入 Bundle 发布期校验](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK2QBO)

## 背景

Runtime Agent Bundle 发布期 ToolGrant 校验原本依赖配置字符串属性
`blue-whale.runtime-bundle.approved-tool-contracts`：条目以 `|` 分隔，schema 与 constraints 以 Base64
编码，由 `RuntimeBundleValidator` 在构造期解析成内存 `Set<ApprovedToolContract>`。该设计有两个缺口：

1. **生产配置为空 → 一切 grant 被拒**。父项 IK2D8K「IK2D8J 现状提醒」记录的缺口：发布期
   `matchesApprovedTool` 对空集合做 `anyMatch` 必然返回 false，平台无任何工具可发布。
2. **配置解析的 record 字段不足**。`ApprovedToolContract(toolName, registryVersion, effect, argumentSchema,
   constraints)` 缺 `risk_level` 与能力 / 模型兼容信息，无法承载工具注册表应有的完整元数据。

工具注册表是其余所有动作治理工单（Worker 工具可见性、动作提议契约升级、commit 服务端复验等）的地基，
必须在程序侧拥有一个权威、可查询、版本化的注册表。

## 决策

### 1. 程序注册表为发布期校验唯一权威

新增 `ToolDefinition`（不可变值类型）与 `ToolRegistry`（Spring `@Component`）。每项 `ToolDefinition`
以 `toolId + registryVersion` 为主键，字段含 `effect`、`riskLevel`、输入 / 输出 Draft 2020-12 JSON Schema、
平台静态约束上界 `constraints`、所需模型能力 `requiredModelCapabilities` 与生图能力类型
`generationCapabilityType`（对接 `generation_model_capability.capabilityType`）。

`RuntimeBundleValidator` 构造器移除 `approved-tool-contracts` `@Value` 注入，改注入 `ToolRegistry`；
`matchesApprovedTool` 从「遍历配置 Set 做 anyMatch」改为「按 `toolId + registryVersion` 查注册表后做
`schemaNoWider` / `constraintsNoWider`」。未注册的 `toolName + registryVersion` 组合在发布期被拒，
错误码沿用 `unauthorized_tool:<name>` 族。

### 2. 既有铁闸原样保留，比较逻辑直接复用

`schemaNoWider` / `constraintsNoWider` / `containsSchemaReference` / `validateToolSchema` 不重写；
`proposal_only` 恒 true、`registry_version >= 1`、`effect ∈ {read, side_effect}`、argumentSchema 声明
2020-12 `$schema`、禁外部 / 动态 / 递归 `$ref` 等铁闸行为不变。注册表只取代「证明 grant 存在且约束不宽于
平台」的对照来源，不放宽或改写任何既有铁闸。

### 3. ToolDefinition 含平台约束上界 constraints

契约字段列表未显式列出 `constraints`，但发布期 `constraintsNoWider` 需要注册表提供平台约束上界作为
对照。因此 `ToolDefinition` 携带 `constraints` 字段，语义为「平台对该工具的静态约束上界」，与
`inputSchema` 一同作为 grant 收窄判定的基准。

### 4. 发布快照固化 registry_version

`RuntimeBundleContractMapper.toolGrantsToContract` 在发布快照 `publishedComposition` 中已写入每个
`toolGrant.registryVersion`，运行中 AgentRun 因快照钉住版本而不因后续注册表变更漂移。本工单补集成测试
断言发布契约 `toolGrants[].registryVersion` 携带原始版本，固化行为由测试守住。

### 5. risk_level 是注册表侧属性

`risk_level`（`low` / `medium` / `high`，平台此前无现成分级）只在 `ToolDefinition` 上定义，用于运行期
接纳策略与审计；ToolGrant 只引用工具不携带风险等级，发布期 grant 校验不读它。

### 6. 配置形态退役

`approved-tool-contracts` 配置 key、`@Value` 注入、`configuredToolContracts` 解析方法与私有 record
全部移除。生产环境不再有空配置缺口——注册表为唯一权威，无配置时基于代码注册项正常工作。

## 考虑过的备选

- **保留配置形态并补全字段**：给 `ApprovedToolContract` 加 `risk_level` 与能力字段。拒绝——配置字符串
  形态本身是生产空配置全拒的根因，补字段不闭环缺口，且 Base64 编码的 schema 不可读、不可审计。
- **ToolDefinition 不含 constraints**：让 constraints 校验退役或改查它处。拒绝——验收要求
  `constraintsNoWider` 对注册表判定，去掉字段则既有可复用逻辑失去对照，等于重写或放宽铁闸。
- **risk_level 作为发布期铁闸**：发布校验读 grant 风险等级。拒绝——风险等级是平台对工具的注册侧属性，
  grant 只引用不携带；把它做成铁闸会引入 grant 自报风险的安全漏洞。
- **把本注册表做成 ADR-0038 的生图 Provider Registry**：统一成可动态注册的 Registry。拒绝——两者边界
  正交：本注册表是 Agent 可提议动作目录，ADR-0038 的 Provider 按 mode 装配，已明确不引入独立 Registry。

## 后果

- 平台工具以代码注册，生产环境不再有空配置导致一切 grant 被拒的缺口；新增工具改代码并升
  `registryVersion`，旧 Bundle 因快照固化版本不受影响。
- `RuntimeBundleLifecycleIT` 覆盖已注册 grant 发布通过、未注册 grant 被拒、grant 宽于平台约束
  （放宽 schema 或 constraints）被拒、发布快照 `registryVersion` 固化。
- CONTEXT.md 以实现事实描述工具注册表：`ToolDefinition` + `ToolRegistry` + `RiskLevel`，并澄清其与
  ADR-0038 生图 Provider Registry 的边界。
- Worker 工具可见性、动作提议契约升级、commit 服务端复验等改造属其余子工单，不在本注册表地基范围。

## 关联

- [ADR-0039](0039-runtime-agent-bundle-published-snapshot.md) — Runtime Agent Bundle 以不可变发布快照驱动运行时
- [ADR-0038](0038-generation-toolkit-and-image-direct-retirement.md) — 统一生图工具包（边界澄清：本注册表 ≠ Provider Registry）
- [Runtime Agent Bundle 领域契约与资源规范](../specs/2026-07-20-runtime-agent-bundle-contract.md) §2.5 ToolGrant / §4 发布校验
