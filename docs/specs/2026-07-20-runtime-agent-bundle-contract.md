# Runtime Agent Bundle 领域契约与资源规范

- **状态**：Accepted for implementation
- **契约版本**：1
- **关联工单**：[定稿 Runtime Agent Bundle 领域契约与资源规范](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK2D8H)
- **机器可读契约**：[runtime-agent-bundle.schema.json](runtime-agent-bundle.schema.json)
- **标准调研**：[Runtime Agent Bundle 外部规范调研](../research/runtime-agent-bundle-contracts.md)

本文冻结 Java Product API、Python Agent Worker 与内部管理页共同消费的 Runtime Agent Bundle
领域边界。它定义发布前的可编辑对象和发布后的不可变快照，不定义数据库表、管理接口或页面布局。

## 1. 不可让渡的边界

1. Java Product API 仍是 Project、Conversation、AgentRun、GenerationJob、Asset、权限、安全、
   成本、并发、幂等、审计和公开事件的唯一权威。
2. Python Agent Worker 只解释已发布 Bundle、调用允许的模型、读取按需资源并提出产品中性动作；
   它不发布 Bundle、不扩大 ToolGrant、不直接产生产品副作用。
3. Runtime Agent Bundle 是平台内部配置，普通 User 不可见；Creative Skill 是用户可见内容，
   保留 `Use` / `auto`，两者不得再用无修饰的 `Skill` 混称。
4. 发布快照是运行时唯一配置来源。仓库里的 Markdown 只作为导入、导出和维护源，生产环境不得
   在快照缺失时静默读取仓库文件或回退硬编码提示词。
5. Bundle 中的 Rule、ModelProfile 和 ToolGrant 只能缩小平台铁闸，不能覆盖或放宽平台铁闸。

## 2. 领域对象

| 对象 | 身份与生命周期 | 契约职责 |
|---|---|---|
| `AgentDefinition` | 稳定 `agentDefinitionId`；可改展示信息 | 表示一个平台内部 Agent 的长期身份，是 Draft 与 Version 的归属根，不承载运行时内容 |
| `RoleDocument` | 稳定 `resourceId` + 递增 `revision` | 单个 Agent 的根角色 Markdown；每个 Bundle 恰好一个，固定 `always_on` |
| `Rule` | 稳定 `resourceId` + 递增 `revision` | 一条 Markdown 行为规则；带唯一可选 `conflictDomain` 和 `always_on` / `on_demand` |
| `RuleSet` | 随 BundleDraft 编辑，随 BundleVersion 固化 | Rule 的有序引用列表；数组顺序就是优先顺序，越靠后不表示可以覆盖冲突 |
| `RuntimeSkill` | 稳定 `resourceId` + 递增 `revision` | 平台内部可执行工作流包；初始只披露元数据，正文及引用资源按需加载 |
| `CreativeSkill` | 稳定 `creativeSkillId` + 不可变版本 | 用户可见创作方法；保留 `Use` / `auto`，激活后版本固定到 AgentRun，不属于 Runtime Bundle 快照 |
| `BundleDraft` | 稳定 `draftId` + 乐观锁 `draftRevision` | 可变工作区；允许校验失败，不可被 Worker 读取 |
| `BundleVersion` | 不可变 `bundleVersionId` + 唯一 SemVer | 一次发布产生的完整闭包；内容、顺序、引用、模型、工具和预算均不可修改 |
| `ModelProfile` | 稳定 `modelProfileId` + 版本 | Bundle 可选择的产品中性模型能力与上下文上限；不包含凭据或供应商私有请求参数 |
| `ToolGrant` | 稳定 `toolName` + `registryVersion` | 允许 Agent 提议的工具子集、参数 Schema、效果类别与静态约束；不代表动作已获授权 |
| `ResourceManifest` | 随 BundleVersion 不可变 | 列出快照内全部资源、内容摘要、大小、token 估算和已解析引用，是导入、加载与复现依据 |

### 2.1 AgentDefinition

`AgentDefinition` 只保存稳定身份与内部展示信息：

```text
agentDefinitionId
key                 # 平台内唯一、不可复用
displayName
description
```

激活中的 BundleVersion 是控制面指针，不嵌入 AgentDefinition 本体。切换或回滚该指针不会修改
AgentDefinition，也不会改写既有 AgentRun。

### 2.2 RoleDocument、Rule 与 RuleSet

- 一个 BundleVersion 必须且只能包含一个 RoleDocument，且 `loadMode=always_on`。
- RuleSet 必须显式列出全部生效 Rule；未在 RuleSet 中的 Rule 不进入快照。
- RuleSet 数组顺序稳定，发布后不得重排。
- Rule 的 `conflictDomain` 为空表示可叠加；非空时同一 BundleVersion 内必须唯一。冲突不能靠
  “后出现者覆盖前者”解决，必须在 Draft 中删掉或改写冲突 Rule 后再发布。
- Rule 只能表达模型行为偏好、路由原则、输出约定和创作约束；不得表达权限授予、成本上限、
  内容审核绕过、并发所有权或产品状态迁移。

### 2.3 RuntimeSkill 与 CreativeSkill

两者共用“元数据 + Markdown 正文 + 相对引用资源”的包形态，但边界不同：

| 维度 | RuntimeSkill | CreativeSkill |
|---|---|---|
| 可见性 | 平台内部 | User 可见 |
| 归属 | BundleVersion | Creative Skill 库 |
| 激活 | Bundle 根 Skill 固定；正文按需读取 | User `Use` 或 `auto` 触发 |
| 权限 | 平台管理员维护 | User 只能选择，不能改变平台铁闸 |
| Run 固定 | 随 BundleVersion 固定 | 首次激活时固定具体版本，后续同一 Run 不漂移 |
| 退役 | 新 Run 停用，旧 Run 保留快照可读 | 新激活停用，已固定 Run 保留版本可读 |

RuntimeSkill 元数据至少包含 `name`、`description`、`allowImplicitInvocation`；元数据进入初始上下文，
完整 Markdown 和引用资源仅在 Agent 选择该 Skill 后加载。P0 只允许一个根 RuntimeSkill，不引入
多根路由器或任意脚本执行。

### 2.4 ModelProfile

ModelProfile 是 Java 已批准模型目录的版本化子集，至少定义：

```text
modelProfileId
version
modelKey
capabilities[]       # text / vision / tool_calling / structured_output
maxInputTokens
maxOutputTokens
```

Bundle 只能引用控制面目录中已批准且版本匹配的 ModelProfile。凭据、Base URL、价格目录、供应商原始
字段和部署密钥不进入 Bundle。Python 可在 Bundle 允许的 Profile 中提出选择，Java 在创建 AgentRun
时固定最终 `modelProfileId + version`。

### 2.5 ToolGrant

ToolGrant 只授予“提议资格”，不能把模型输出变成已授权命令：

```text
toolName
registryVersion
effect               # read | side_effect
proposalOnly          # P0 恒为 true
argumentSchema        # JSON Schema 2020-12
constraints           # 产品中性静态上限
```

发布时必须证明 `toolName + registryVersion` 存在于 Java 工具注册表，参数 Schema 与注册表兼容，
Bundle 约束不宽于平台约束。运行时 Java 仍按 User、Project、AgentRun、资源归属、有效
UserInputRequest、幂等、成本和内容安全逐次接纳或拒绝提议。

## 3. 身份、版本、摘要与引用

### 3.1 三层版本

| 层 | 字段 | 规则 |
|---|---|---|
| 契约 | `schemaVersion` | P0 固定 `1`；破坏性字段变更发布新 major |
| Bundle | `version` | AgentDefinition 内唯一 SemVer；已发布版本号永不复用 |
| 资源 | `revision` | 同一 `resourceId` 下单调递增正整数；发布后该 revision 内容不可变 |

`bundleVersionId`、`resourceId` 与 `creativeSkillVersionId` 是系统身份；版本号是人类与兼容策略使用的
标签，不能替代系统身份。

Bundle 的 SemVer 公共面由三部分共同组成：本 Schema / manifest 结构、ToolGrant / ModelProfile / 资源
装载接口，以及可观察的 Agent 能力契约。破坏字段、删除能力或改变既有工具参数语义升 MAJOR；新增
可选能力且旧调用仍有效升 MINOR；不改变能力面与输入输出语义的文字纠错升 PATCH。任何内容变化仍须
产生新版本与新摘要，不能只靠 build metadata 区分。

### 3.2 路径与相对引用

- 资源 `path` 必须是 UTF-8 POSIX 相对路径；禁止绝对路径、空段、`.`、`..`、反斜杠和跳出包根。
- 每个 BundleVersion 的逻辑基址为 `bw-bundle://<bundleVersionId>/`；Draft 校验使用等价临时基址。
- 作者可写 `../rules/safety.md` 等相对 URI。发布器按 RFC 3986 语义解析后，必须把
  `rawRef` 与 `resolvedResourceId` 一起固化进 ResourceManifest。
- 运行时只使用已固化的 `resolvedResourceId`，不再次对数据库、仓库或网络做模糊查找。
- 引用目标必须在同一快照闭包内；不允许网络 URL、宿主文件路径、符号链接或跨 Bundle 引用。

### 3.3 内容摘要

- Markdown / 文本在发布前必须已经是 UTF-8（无 BOM）和 LF；发布器校验但不静默改写，摘要计算对象
  是发布者提交的确切字节。需要换行或编码迁移时先在 Draft 中显式产生新 revision。
- 每个资源使用 `sha256:<64 位小写十六进制>`；摘要不同即为不同 revision 内容。
- `manifestDigest` 对移除自身 `manifestDigest` 字段后的 manifest 使用 RFC 8785 JSON Canonicalization
  Scheme 规范化，再计算 SHA-256。
- 归档容器的文件顺序、时间戳或压缩参数不参与身份；可复现性由 manifest 与每个资源摘要保证。

## 4. ResourceManifest 与发布校验

ResourceManifest 至少包含：

```text
formatVersion
baseUri
digestAlgorithm       # sha256
manifestDigest
resources[]:
  resourceId
  revision
  kind                # role_document / rule / runtime_skill / reference
  path
  mediaType
  loadMode
  contentDigest
  sizeBytes
  tokenEstimate
  references[]:
    rawRef
    resolvedResourceId
```

发布器必须在一个事务边界内完成以下静态门禁；任一失败都只更新 Draft 的校验结果，不产生
BundleVersion：

1. JSON Schema 与字段格式合法。
2. 恰好一个 RoleDocument、恰好一个根 RuntimeSkill；RuleSet 引用完整且顺序无重复。
3. 所有相对引用可确定解析、目标存在、路径不越界、内容摘要与实际字节一致。
4. 引用图无自环、无强连通分量；错误必须返回完整循环路径。
5. `conflictDomain` 在整个 RuleSet 内唯一。
6. `always_on` 只允许 RoleDocument 与必要 Rule；RuntimeSkill / CreativeSkill 正文保持 `on_demand`。
7. TokenBudget 的三个门均通过。
8. ModelProfile 与 ToolGrant 都是当前平台目录的兼容子集。
9. Bundle 不包含凭据、供应商私有配置、绝对路径、未知资源类型或未列入 manifest 的文件。
10. 行为场景、协议测试和隔离试运行由后续发布门票据执行；静态校验通过不等于可以激活。

ToolGrant 的 `argumentSchema` 必须是自包含 Draft 2020-12 Schema：P0 禁止外部 `$ref`、`$dynamicRef`
和递归引用，关键 URI / 日期 / 版本字段在 Schema 后另做确定性领域校验，不依赖 validator 默认的
`format` annotation 行为。Bundle 资源引用图与 JSON Schema 求值图是两个边界；P0 两者都不接受环。

### 4.1 循环依赖

发布校验把每个 manifest `references` 视为有向边，对完整资源图运行环检测。任何环都阻断，
包括 Rule A → Reference B → Rule A 以及资源自引用。P0 不提供“允许的软环”或最大展开深度配置。

### 4.2 TokenBudget

```text
estimator             # 版本化平台估算算法，如 blue-whale-conservative-v1
initialContextMaxTokens
singleResourceMaxTokens
activeContextMaxTokens
```

- `initialContextMaxTokens`：RoleDocument + `always_on` Rules + 全部可发现 Skill 元数据。
- `singleResourceMaxTokens`：任一可按需加载资源的上限。
- `activeContextMaxTokens`：一次模型调用中已装载 Bundle 资源的总上限。
- 发布时写入每个资源的 `tokenEstimate`；运行时在按需加载前重新累计，超限时拒绝加载并返回规范化
  `BUNDLE_TOKEN_BUDGET_EXCEEDED`，不得静默截断 Rule 或 Skill。
- 模型供应商的真实上下文与计费上限仍由 Java 的 ModelProfile / 成本铁闸执行；Bundle 预算不能扩大它。

## 5. Draft、发布、激活与回滚

```text
editing ──validate──> valid ──publish──> BundleVersion(immutable)
   └───────────────> invalid

BundleVersion ──activate──> AgentDefinition.activeVersion
older BundleVersion ──rollback──> AgentDefinition.activeVersion
```

- `BundleDraft` 可变，每次写入递增 `draftRevision`；更新必须带预期 revision，冲突返回而不覆盖。
- `publish` 只接受最近一次校验通过且 revision 未变化的 Draft。发布原子地产生 BundleVersion、
  ResourceManifest 和审计记录；失败不得留下部分快照。
- BundleVersion 的任何内容都不能原地修改、删除后复用版本号或用回滚改写。
- `activate` / `rollback` 只切换 AgentDefinition 的活动版本指针，并记录 from/to 版本与操作者。
- 回滚只影响之后创建的 AgentRun；既有 Run 继续使用其固定快照。

## 6. AgentRun 固定与渐进装载

Java 创建 AgentRun 时必须原子固定：

```text
bundleVersionId
manifestDigest
modelProfileId
modelProfileVersion
activatedCreativeSkillVersions[]
```

`activatedCreativeSkillVersions` 初始可为空；某个 Creative Skill 首次被 `Use` / `auto` 激活时，Java
把当时的不可变版本追加到 Run pin。之后同一 Run 只能复用该版本，不能漂移到新版本。

Worker 认领 Run 时：

1. 通过 Java 内部接口按 `bundleVersionId` 取得发布快照，校验 `manifestDigest`。
2. 初始装载 RoleDocument、`always_on` Rules 和 Runtime/Creative Skill 元数据。
3. Agent 选择 Skill 或引用资源时，按已解析 resourceId 读取内容；每次读取前执行 token 预算。
4. Worker commit 必须回传已使用的 Bundle、ModelProfile、CreativeSkill 与资源摘要证据。
5. 版本缺失、摘要不符、资源未授权或预算超限时 fail closed；生产环境不得切换到默认提示词或 Mock。

Bundle 固定与 `engine + engineVersion + adapterSchemaVersion` 固定是正交维度：前者固定行为配置，
后者固定 checkpoint 解释器。RuntimeCheckpoint 继续只保存框架不透明状态，不复制 Bundle 内容。

## 7. 平台铁闸与可编辑内容

| 平台不可协商铁闸（Bundle 不能改） | Bundle 可编辑内容 |
|---|---|
| User / Project 归属与权限 | Agent 角色、语气与任务边界 |
| 工具注册、参数上界与副作用接纳 | 在已授权工具中的选择与提议时机 |
| 内容审核与输出释放 | 创作质量、自检与追问策略 |
| 成本预留、模型目录与 token 硬上限 | 在已批准 ModelProfile 中的偏好 |
| 幂等、租约、栅栏、并发与状态迁移 | Skill 路由、Rule 顺序、资源按需读取 |
| GenerationJob / Asset 生命周期 | 产品中性的动作参数草案 |
| Conversation 持久化与 Project SSE | 用户可见文字草案（仍须 Java 接纳） |
| 审计、凭据与供应商配置 | 不含敏感信息的内部运行说明 |

静态可识别的越权 Rule 在发布时阻断；无法静态识别的冲突在运行时以平台铁闸为准，并形成审计，
不得把模型遵守 Rule 当作安全边界。

## 8. 导入、导出与审计

### 8.1 便携布局

```text
manifest.json
resources/<manifest path>
```

- 导出只允许已发布 BundleVersion；`manifest.json` 必须满足本契约并与资源摘要一致。
- 导入先在隔离区校验路径、媒体类型、大小、摘要、引用闭包、环和 Schema，再创建新的 BundleDraft；
  导入永不直接发布或激活。
- 导入保留 `origin.bundleVersionId` / `origin.manifestDigest` 供审计，但分配本地 Draft 身份；同一
  manifestDigest 可去重，不用来源系统 ID 覆盖本地对象。
- 未知 `schemaVersion`、摘要不符、额外文件、缺失文件、路径穿越或网络引用全部 fail closed。

P0 只要求逻辑往返可复现，不要求 ZIP / TAR 容器逐字节一致；若未来需要稳定 archive digest，必须
另行冻结条目顺序、时间戳、属主、权限、额外属性、压缩算法和工具版本。

### 8.2 审计事件

至少记录 `draft.created`、`draft.updated`、`draft.validated`、`version.published`、
`version.activated`、`version.rolled_back`、`version.exported`、`draft.imported`。审计保存操作者、
AgentDefinition、Draft/Version、from/to 版本、manifestDigest、结果与规范化错误码，不复制完整资源正文。

## 9. 现有模型迁移与兼容结论

| 现状 | 新模型 | 迁移 / 兼容结论 |
|---|---|---|
| `skill` 表的 `name/description/content/source/sortOrder/coverUrl` | `CreativeSkill` + 首个不可变版本 | 原数据是用户可见库内容，只迁为 CreativeSkill；不得迁成 RuntimeSkill |
| `user_skill(skillId, auto)` | User 与 CreativeSkill 稳定身份关系 | 保留 `Use` / `auto`；运行时首次激活后记录具体 CreativeSkillVersion |
| `blue-whale-agent-workspace/skill/SKILL.md` | 根 RuntimeSkill 候选 | 只能经后续审计、拆分、校验后导入 Draft；不能把整个目录原样发布 |
| `skill/workers/*.md` | RoleDocument / RuntimeSkill 引用资源候选 | 逐项判断；角色与工作流不再用“worker 文件即产品角色”隐式约定 |
| `skill/rules/*.md` | Rule 候选 | 逐条分配 loadMode、conflictDomain、revision；与平台铁闸冲突的内容删除而非迁移 |
| 代码内硬编码 Pydantic AI instructions/tools | Bundle RoleDocument + RuntimeSkill + ToolGrant | 生产路径删除静默硬编码回退；Fake 只保留测试模式 |
| `AgentRun.engine*` / `RuntimeCheckpoint` | 保留并新增 Run pin | 引擎固定不替代 Bundle/模型/Creative Skill 固定；checkpoint 不嵌 Bundle |
| 旧 `decision_context` + 固定九分支 | Java 权威事实 + Bundle Skill 自主决策 | **废弃，不做兼容 DTO**；权限、安全、成本、并发、幂等、状态铁闸继续由 Java 提供，语义路由交给 Agent |
| 旧 `POST /api/projects/{projectId}/agent/turn` 文档 | `POST /api/projects/{projectId}/conversation/messages` + Project SSE | **废弃且不实现兼容端点**；代码中不存在该 route，文档与前端残留由迁移票据清理 |
| `/api/projects/{projectId}/conversation/messages` | 保留 | 继续是用户消息唯一命令入口，不让 Bundle 变成第二个公开控制面 |

旧 `decision_context` 中可验证的产品事实可以作为受控上下文字段或读取工具继续提供，但
`intent_direction`、`suggested_route`、`decision_branch` 与固定 L1 classifier 不进入新契约。

## 10. 各实现面的最小交接

### Java Product API

- 持有 AgentDefinition、Draft、Version、活动版本指针、资源字节、校验结果和审计。
- 原子发布不可变快照；按 Run 提供固定版本和资源读取；执行 ToolGrant / ModelProfile 的平台交集校验。
- 在 AgentRun 创建与 Creative Skill 首次激活时落版本 pin；公开 SSE 只发布 Java 已接纳事实。

### Python Agent Worker

- `RunWork` 新增 Bundle / ModelProfile / CreativeSkill pin 与受控资源读取能力。
- 移除生产硬编码 instructions / tool tuple，把框架类型留在 Adapter 内。
- 只按 ResourceManifest 的 resolvedResourceId 读取，不解释 Draft，不扫描仓库，不做网络资源解析。

### 内部管理页

- 只编辑 BundleDraft；展示校验错误、资源引用图、冲突域和 token 预算。
- 发布后页面只读；激活与回滚是独立、有审计的动作。
- Creative Skill 库继续是独立产品面，不与 Runtime Bundle 管理页合并。

## 11. 外部规范调研问题的决议

| 调研问题 | 本契约决议 |
|---|---|
| SemVer 公共 API | Schema / manifest、装载与 Grant/Profile 接口、可观察 Agent 能力共同组成；规则见 3.1 |
| Bundle 根摘要 | 采用 SHA-256(JCS(manifest 去除自身摘要字段))，JCS 固定 RFC 8785 |
| 归档逐字节复现 | P0 不要求，只要求逻辑 manifest 与资源摘要往返一致 |
| 外部引用 | 禁止；发布快照必须完全自包含且默认离线解析 |
| 递归 Schema | P0 ToolGrant 禁止外部、动态和递归引用；关键 format 另做领域校验 |
| 跨平台资产 | 采用中立领域模型 + 运行时适配输出；不把 Codex / Claude 的原生目录覆盖语义当共同语义 |
| 来源可信 | P0 只允许已认证内部管理员经控制面导入并全量审计；摘要证明完整性、不证明作者身份；跨组织或不可信渠道导入前必须另行引入签名与信任根 |

Codex / Claude 官方规则只用于确定 RoleDocument、Rule 与 Skill 的设计边界和渐进装载原则。当前生产
消费者是受 `OrchestratorPort` 约束的 Python Adapter；Bundle 不尝试模拟两个编码 Agent 产品的完整
目录发现、覆盖、local memory 或平台私有扩展。

## 12. 协议验收矩阵

1. 同一 BundleVersion 二次读取的 manifest 与所有资源摘要完全一致。
2. 修改任一已发布资源必须产生新 resource revision 与新 BundleVersion。
3. 缺失引用、`../` 越界、自环、跨资源环、重复 conflictDomain 均在发布前阻断。
4. `always_on` 总量、单资源或活动上下文任一超预算均阻断发布或加载，且不截断内容。
5. Bundle 的 ToolGrant / ModelProfile 比平台宽时发布失败；比平台窄时可发布。
6. 回滚后新 Run 使用旧版本，回滚前 Run 仍恢复原版本。
7. Creative Skill 在 Run 中首次激活后，即使库发布新版，该 Run 仍读取旧版本。
8. Worker 缺失快照或摘要不符时 fail closed，生产环境不读仓库、不用 Mock。
9. 导出再导入后 manifestDigest 与资源摘要不变；容器元数据差异不影响身份。
10. 旧 `/agent/turn` 与 `decision_context.decision_branch` 不进入新 API、数据库或 Worker DTO。

## 13. 明确不包含

- 数据库 DDL、REST/OpenAPI 路由、管理页 UI、Worker 解析器或发布服务实现。
- 多租户自定义 Agent、普通 User 编辑 Runtime Bundle、跨 Bundle 依赖、远程资源、任意脚本执行。
- 行为评测用例、灰度比例、自动回滚阈值和生产发布编排；这些由后续发布门票据定义。
