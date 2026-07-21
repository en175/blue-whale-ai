# 运行时 Agent Bundle 契约：外部规范研究

> 调研日期：2026-07-20
>
> 调研范围：OpenAI Codex、Anthropic Claude Code / Agent Skills、JSON Schema Draft 2020-12、SemVer、内容寻址、JSON 规范化与可复现归档。
>
> 证据标记：**官方事实**表示来源直接规定或说明的行为；**项目推论**表示结合运行时 Agent Bundle、ResourceManifest、导入/导出需求作出的设计建议，不是外部规范原文。

## 结论摘要

1. **Bundle 应是不可变快照，而不是可变目录别名。** SemVer 用于表达公共契约的兼容性；内容摘要用于标识和验证确切字节。二者互补，不能互相替代。[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) 要求发布后的同一版本内容不得修改；[RFC 6920](https://www.rfc-editor.org/rfc/rfc6920) 和 [OCI Content Descriptor](https://specs.opencontainers.org/image-spec/descriptor/) 则给出了以算法加摘要标识内容、消费前重新计算摘要的模式。
2. **ResourceManifest 应成为 Bundle 内容闭包的权威索引。** 每个资源至少记录规范化路径、媒体类型、字节数和带算法的摘要；manifest 本身采用确定性 JSON 表示并计算摘要。Bundle 的逻辑身份可由规范化 manifest 的摘要给出，因为 manifest 已传递性地承诺所有资源摘要。这是基于 OCI Descriptor 与 RFC 8785 的**项目推论**，不是两份规范对本项目字段的直接要求。[OCI Content Descriptor](https://specs.opencontainers.org/image-spec/descriptor/)；[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)
3. **平台原生发现语义不能被假定为统一覆盖算法。** Codex 的 `AGENTS.md` 明确以靠近当前目录的内容覆盖较早内容；Claude Code 将发现的 `CLAUDE.md` 拼接进上下文，并明确警告冲突指令可能被任意选择。跨平台 Bundle 应保存资源、来源层级和平台适配信息，由 OpenAI/Anthropic 适配器分别生成有效运行时布局，而不是先做一次“通用合并”。[OpenAI `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)；[Anthropic memory / `CLAUDE.md`](https://code.claude.com/docs/en/memory)
4. **Skills 的可移植核心是开放 Agent Skills 文件格式，不是任一产品的全部运行时扩展。** `SKILL.md`、`name`、`description`、按需资源是共同核心；目录发现、优先级、调用控制、上下文分叉等是产品行为或扩展，必须显式适配。[Agent Skills Specification](https://agentskills.io/specification)；[OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills)；[Anthropic Claude Code skills](https://code.claude.com/docs/en/slash-commands)
5. **Schema 导入应在离线资源注册表中完成引用闭包验证。** `$id` 是规范 URI 而非下载地址，`$ref` 按当前基准 URI 解析；实现不应看见 HTTP URI 就默认联网。导入时应拒绝重复 `$id`、无法解析的 `$ref`、错误 dialect 和会造成无穷求值的引用结构。[JSON Schema Core 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)
6. **“逻辑内容可复现”与“归档字节可复现”应分开定义。** JCS 可稳定 manifest 的 JSON 字节；若还要求 ZIP/TAR 本身摘要稳定，则必须固定条目顺序、时间戳、属主、组、权限、额外属性和压缩设置。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)；[Reproducible Builds：Archive metadata](https://reproducible-builds.org/docs/archives/)

## 1. OpenAI Codex：`AGENTS.md` 与 Skills

### 1.1 `AGENTS.md` 的发现、层级与覆盖

- **官方事实：启动时构建一次指令链。** Codex 在每次运行开始时读取指令。全局层在 `CODEX_HOME`（默认 `~/.codex`）先检查 `AGENTS.override.md`，否则检查 `AGENTS.md`，且只取第一个非空文件。[OpenAI `AGENTS.md`：How Codex discovers guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- **官方事实：项目层从项目根走到当前工作目录。** 每一级目录依次检查 `AGENTS.override.md`、`AGENTS.md`，再检查配置的 fallback 文件名；每个目录最多纳入一个文件。无法识别项目根时只检查当前目录。[同上](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- **官方事实：合并顺序具有覆盖语义。** Codex 从根到当前目录拼接文件，靠近当前目录的文件后出现，因此其指导覆盖更早层级。空文件跳过；组合内容达到 `project_doc_max_bytes` 后停止，默认上限为 32 KiB。[同上](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)

由此得到的**项目推论**：

- Bundle 的解析输入必须包含明确的“目标平台 + 项目根 + 工作目录/作用域”；仅给出文件集合不足以唯一重建 Codex 的有效指令链。[依据：Codex 的发现起点和目录链](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- 不应在 Bundle 内把多个 `AGENTS.md` 物理合并成一个丢失来源的文本。ResourceManifest 应保留每个文件的相对位置、资源摘要和层级来源，运行时适配器再按 Codex 规则装配。[依据：Codex 的 root-to-CWD 合并顺序](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- `AGENTS.override.md` 与 fallback 名称会改变选择结果；若 Bundle 承诺可复现运行，相关配置也必须成为受摘要保护的资源或显式运行参数。[依据：Codex 的目录内候选优先级](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)

### 1.2 Codex Skills 的发现与渐进式披露

- **官方事实：Skills 分阶段进入上下文。** Codex 初始只放入每项 Skill 的 `name`、`description` 和文件路径；选择 Skill 后才加载完整 `SKILL.md`。初始 Skill 列表最多占上下文窗口的 2%，未知窗口时上限为 8,000 字符；列表过大时先缩短描述，仍过大时可能省略部分 Skill。[OpenAI Build skills：progressive disclosure](https://learn.chatgpt.com/docs/build-skills)
- **官方事实：Skill 是目录。** 最低要求为含 `name` 和 `description` 的 `SKILL.md`，还可有 `scripts/`、`references/`、`assets/` 和 OpenAI 的可选 `agents/openai.yaml`。[同上](https://learn.chatgpt.com/docs/build-skills)
- **官方事实：可显式或隐式触发。** 显式触发由用户点名；隐式触发依赖任务与 `description` 的匹配，因此 OpenAI 建议描述简洁、边界清楚并前置主要触发词。[同上](https://learn.chatgpt.com/docs/build-skills#how-codex-uses-skills)
- **官方事实：仓库 Skills 按目录扫描，但同名项不合并。** Codex 从当前工作目录到仓库根扫描每级 `.agents/skills`，另有用户、管理员和系统位置；两个 Skill 使用相同 `name` 时不会合并，可能同时出现在选择器中。[同上](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)

由此得到的**项目推论**：

- ResourceManifest 的 Skill 主键不能只用 `name`；应使用 Bundle 内稳定逻辑 ID 或规范化路径，并把展示名/触发名作为属性，否则同名 Skill 无法无损往返。[依据：Codex 明确不合并同名 Skill](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)
- 导出必须包含 `SKILL.md` 引用到的资源闭包。catalog 只需要紧凑元数据；完整指令、reference 和脚本保持独立资源，才能保留渐进式披露的上下文收益。[依据：OpenAI Skills 渐进式披露](https://learn.chatgpt.com/docs/build-skills)
- `agents/openai.yaml` 是 OpenAI 产品扩展，不属于开放 Agent Skills 最小格式。跨平台核心与平台扩展应分开建模，不能要求 Anthropic 消费者解释 OpenAI 专用字段。[依据：OpenAI 扩展结构](https://learn.chatgpt.com/docs/build-skills)；[开放 Agent Skills 最小格式](https://agentskills.io/specification)

## 2. Anthropic：`CLAUDE.md`、memory 与 Agent Skills

### 2.1 `CLAUDE.md` memory 模型与编写建议

- **官方事实：`CLAUDE.md` 与 auto memory 是两套互补机制。** 前者由人编写项目/用户/组织指令，后者由 Claude 记录可复用经验；二者都作为上下文而非强制配置。需要确定执行的限制应由权限、sandbox 或 hook 等机制承担。[Anthropic：How Claude remembers your project](https://code.claude.com/docs/en/memory)
- **官方事实：层级文件被拼接，不是规范化覆盖。** Claude Code 从当前工作目录向上发现 `CLAUDE.md` 与 `CLAUDE.local.md`，按文件系统根到当前目录排序；同级的 local 文件后置。所有发现内容被拼接。工作目录下方的 `CLAUDE.md` 在 Claude 读取对应子目录文件时才按需加入。[同上：How CLAUDE.md files load](https://code.claude.com/docs/en/memory#how-claudemd-files-load)
- **官方事实：冲突行为不应依赖。** Anthropic 明确指出，如果两条规则矛盾，Claude 可能任意选择其一；建议定期移除陈旧或冲突指令。因此“后出现”不能被当成与 Codex 相同的确定覆盖契约。[同上：Write effective instructions](https://code.claude.com/docs/en/memory#write-effective-instructions)
- **官方事实：导入有自己的解析规则。** `CLAUDE.md` 可用 `@path` 导入相对或绝对文件；相对路径以包含该导入的文件为基准。当前官方文档将递归导入深度限制为四跳，项目外部导入首次出现时需要用户确认。[同上：Import additional files](https://code.claude.com/docs/en/memory#import-additional-files)
- **官方事实：Claude Code 不直接把 `AGENTS.md` 当作原生指令文件。** 官方建议在 `CLAUDE.md` 中导入 `@AGENTS.md`，或在适用平台使用符号链接，以避免复制维护。[同上：AGENTS.md](https://code.claude.com/docs/en/memory#agentsmd)
- **官方事实：建议短、具体、结构化。** Anthropic 建议单个 `CLAUDE.md` 目标控制在 200 行以内；长文件会占用更多上下文并降低遵循度。多步骤、任务相关内容更适合 Skill，路径相关规则更适合 `.claude/rules/`。[同上：Write effective instructions](https://code.claude.com/docs/en/memory#write-effective-instructions)

由此得到的**项目推论**：

- 跨平台 Bundle 不应把 Codex 的“近目录覆盖”强加给 Claude。运行时应保留并复现 Claude 的拼接/按需加载语义，同时在构建或导入阶段静态报告明显冲突。[依据：Claude 的拼接与冲突说明](https://code.claude.com/docs/en/memory#how-claudemd-files-load)；[Codex 的覆盖顺序](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)
- `CLAUDE.local.md` 和 auto memory 带有个人、机器本地或工作树共享语义，不应默认进入团队发布 Bundle。只有显式声明可发布、经过脱敏并被 manifest 收录时才允许打包。[依据：Claude memory 的作用域与存储说明](https://code.claude.com/docs/en/memory)
- `@` 导入必须在发布前求闭包。默认建议拒绝 Bundle 外引用；若业务允许外部引用，则必须记录其解析策略、授权策略和不可变摘要，否则导入结果取决于机器状态。[依据：Claude 导入解析与外部授权行为](https://code.claude.com/docs/en/memory#import-additional-files)

### 2.2 Anthropic Agent Skills 与开放规范

- **官方事实：Anthropic 采用三层渐进式披露。** Level 1 在启动时加载 `name`/`description`；Level 2 在触发时加载 `SKILL.md` 指令；Level 3 仅在需要时读取额外资源或执行脚本。[Anthropic Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#how-skills-work)
- **官方事实：开放 Agent Skills 最小格式。** Skill 目录至少含带 YAML frontmatter 和 Markdown 正文的 `SKILL.md`；`name` 与 `description` 必填，`scripts/`、`references/`、`assets/` 可选。规范建议 `SKILL.md` 少于 500 行、引用保持一层深，并提供 `skills-ref validate` 做格式校验。[Agent Skills Specification](https://agentskills.io/specification)
- **官方事实：Claude Code 在开放格式上增加产品扩展。** Claude Code 支持个人、项目、企业和插件位置，并定义同名优先级、嵌套目录按需发现、调用控制、工具预授权、动态上下文与子代理执行等扩展。这些不是开放格式对所有客户端的共同要求。[Anthropic：Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)
- **官方事实：Anthropic 的生产治理建议与不可变发布一致。** 企业指南建议生产环境固定具体 Skill 版本，每次更新都视为新部署，保留上一个已知良好版本；部署时计算并验证已审查 Skill 的 checksum，并使用签名提交保证来源。[Anthropic：Skills for enterprise](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise#versioning-strategy)

由此得到的**项目推论**：

- Bundle 内的可移植 Skill 核心应先满足开放 Agent Skills 校验；OpenAI/Anthropic 专用字段应置于平台扩展资源或有命名空间的元数据中。[依据：开放 Agent Skills 格式](https://agentskills.io/specification)；[Claude Code 扩展](https://code.claude.com/docs/en/slash-commands)；[OpenAI 扩展](https://learn.chatgpt.com/docs/build-skills)
- 导入器应区分“格式合法”与“平台可执行”：开放规范校验通过不代表脚本依赖、网络权限、允许工具或平台专用 frontmatter 已满足。[依据：开放规范的格式校验边界](https://agentskills.io/specification#validation)；[Anthropic Skill 运行与安全说明](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- 生产激活应先把可变选择（例如 `latest`）解析成不可变 Bundle 摘要，并在执行记录中固定该摘要；`latest` 只应是注册表别名，而不是 Bundle 身份。[依据：Anthropic 生产版本固定与 checksum 建议](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise#versioning-strategy)

## 3. JSON Schema Draft 2020-12：标识、引用、循环与验证

### 3.1 规范事实

- **`$id` 是规范 URI，不保证可下载。** `$id` 必须是合法 URI-reference，解析后成为无 fragment 的绝对 URI（空 fragment 仅为兼容而保留）；根 Schema 建议直接使用无 fragment 的绝对 URI。该 URI 同时是当前 Schema Resource 内相对引用的 base URI。[JSON Schema Core §8.2.1](https://json-schema.org/draft/2020-12/json-schema-core#name-the-id-keyword)
- **子 Schema 的 `$id` 可建立新资源边界。** 子 Schema 使用相对 `$id` 时，以父 Schema Resource 的 URI 为基准解析；最近的资源 `$id` 决定其内部引用基准。[同上](https://json-schema.org/draft/2020-12/json-schema-core#name-the-id-keyword)
- **`$ref` 是静态 URI 引用。** 其值必须是 URI-reference，按当前 base URI 解析得到要应用的 Schema URI；解析可在 Schema 加载阶段完成。`$ref` 的目标 URI只是标识符，实现不应假定看到网络 URL 就必须发起网络请求。[JSON Schema Core §8.2.3](https://json-schema.org/draft/2020-12/json-schema-core#name-schema-references)
- **自引用用于递归实例是合法能力。** `$ref`/`$dynamicRef` 允许跨文件引用和通过自引用验证递归结构。[同上](https://json-schema.org/draft/2020-12/json-schema-core#name-schema-references)
- **无穷递归求值不是合法依赖策略。** 规范要求 Schema 对实例求值时不得陷入无限循环；例如两个 Schema 只通过 `allOf` 无条件互引会造成未定义行为，Schema 作者应避免此类无限递归嵌套。[JSON Schema Core §9.4.1](https://json-schema.org/draft/2020-12/json-schema-core#name-guarding-against-infinite-rec)
- **dialect 与元 Schema 验证是处理前提。** `$schema` 声明 dialect 和对应 meta-schema；Schema 必须对其 meta-schema 验证成功。Compound Schema Document 中存在多个资源时，官方建议逐个 Schema Resource 按各自 meta-schema 验证。[JSON Schema Core §8.1、§9.3.3](https://json-schema.org/draft/2020-12/json-schema-core)
- **`format` 默认不等于强断言。** 2020-12 的 Format-Annotation vocabulary 要求收集注解，但实现默认不必据此判失败；只有声明并支持 Format-Assertion vocabulary，或显式开启相应实现行为时，才能依赖格式断言。[JSON Schema Validation §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#name-implementation-requirements)

### 3.2 对 Bundle Schema 注册与导入验证的推论

以下均为**项目推论**：

1. **建立离线 Schema Registry。** 以绝对 `$id` 为键，把 ResourceManifest 中的规范 URI 映射到 Bundle 内路径和摘要。解析 `$ref` 时只查该注册表；默认禁止隐式联网，这既符合 `$id`“标识而非 locator”的定义，也保证离线导入可复现。[依据：`$id` 与 `$ref` 的 URI/非 locator 语义](https://json-schema.org/draft/2020-12/json-schema-core#name-base-uri-anchors-and-derefer)
2. **导入前验证引用闭包。** 至少检查：每个 Schema 有明确 Draft 2020-12 dialect、每个 Schema Resource 通过 meta-schema、`$id` 唯一、所有 `$ref` 可解析、目标确为 Schema Resource、引用不越出允许的资源闭包。[依据：meta-schema 与 Compound Schema 验证要求](https://json-schema.org/draft/2020-12/json-schema-core)
3. **相对引用绑定规范 URI，不绑定解压路径。** 给每个可复用根 Schema 稳定绝对 `$id`，让相对 `$ref` 以语义 URI 解析；manifest 负责把解析后的 URI 映射到本地资源。这样资源从 ZIP 解到不同临时目录不会改变引用结果。[依据：`$id` 建立 base URI、相对引用按 base 解析](https://json-schema.org/draft/2020-12/json-schema-core#name-the-id-keyword)
4. **区分“引用图有环”和“求值无进展”。** 合法递归数据 Schema 可以形成环；应拒绝的是在同一实例位置反复进入同一 Schema 位置、无法推进实例遍历的无穷求值。验证器仍须有深度、资源和 `(schema location, instance location)` 周期保护。[依据：自引用能力与无限递归防护](https://json-schema.org/draft/2020-12/json-schema-core#name-guarding-against-infinite-rec)
5. **不要仅靠 `format` 校验关键字段。** 若 URI、日期或自定义版本字符串是导入安全边界，应明确启用 Format-Assertion，或在 JSON Schema 之后增加确定性的领域校验；不能假定任意 2020-12 validator 都会拒绝错误 `format`。[依据：Format-Annotation / Format-Assertion 的实现要求](https://json-schema.org/draft/2020-12/json-schema-validation#name-implementation-requirements)
6. **Bundling 不等于盲目内联 `$ref`。** Core 附录说明，只有各资源拥有绝对 `$id` 且静态引用都按规范 URI 解析时，把外部资源复制到 `$defs` 才能安全、可逆；一般引用消除并不总能保持行为。[JSON Schema Core Appendix B](https://json-schema.org/draft/2020-12/json-schema-core#name-schema-bundling)

## 4. 不可变 Bundle、ResourceManifest、版本与可复现往返

### 4.1 SemVer：兼容性信号，不是内容身份

- **官方事实：使用 SemVer 必须先声明公共 API。** `MAJOR.MINOR.PATCH` 的增量分别表示不兼容 API 变更、向后兼容功能增加、向后兼容缺陷修复。[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)
- **官方事实：发布内容不可原地修改。** 同一已发布版本的内容不得修改；任何修改都必须发布新版本。[同上 §3](https://semver.org/spec/v2.0.0.html#spec-item-3)
- **官方事实：build metadata 不参与优先级。** 仅 `+...` 不同的两个版本具有相同 SemVer precedence；预发布版本则低于相同 core version 的正式版本。[同上 §9–11](https://semver.org/spec/v2.0.0.html#spec-item-9)

对应的**项目推论**：

- 先明确 Bundle 的“公共 API”是什么：至少应包括 manifest/schema 格式、运行时可观察行为和平台适配契约。没有这一定义，版本号无法可靠传达兼容性。[依据：SemVer 要求声明公共 API](https://semver.org/spec/v2.0.0.html#spec-item-1)
- `bundleVersion` 表达兼容性与发布序列；`bundleDigest` 表达确切内容。缓存、审计、激活和回滚应固定 digest，依赖选择策略才使用版本范围。[依据：SemVer 兼容性规则](https://semver.org/spec/v2.0.0.html)；[RFC 6920 内容哈希标识](https://www.rfc-editor.org/rfc/rfc6920)
- 不要用 SemVer build metadata 区分两个不同 Bundle 的身份，因为 SemVer 明确忽略其优先级；不同字节必须有不同摘要，并且内容变化必须产生新发布版本。[依据：SemVer §3、§10–11](https://semver.org/spec/v2.0.0.html)

### 4.2 内容寻址与 ResourceManifest

- **官方事实：哈希名绑定算法与摘要。** RFC 6920 定义用哈希输出命名资源，并规定比较名称时关注摘要算法和摘要值；其安全章节强调哈希只能提供“名称—字节”的完整性绑定，可信程度仍取决于名称从何而来。[RFC 6920](https://www.rfc-editor.org/rfc/rfc6920)
- **官方事实：OCI Descriptor 是成熟的 manifest 资源描述模式。** Descriptor 的核心字段包含 `mediaType`、`digest`、原始字节 `size`；消费不可信来源的内容前，应校验 size 和 digest。digest 使用 `algorithm:encoded` 形式，OCI 要求实现 SHA-256 验证。[OCI Content Descriptor](https://specs.opencontainers.org/image-spec/descriptor/)

建议的最小 ResourceDescriptor 是以下**项目推论**：

```json
{
  "path": "schemas/example.schema.json",
  "mediaType": "application/schema+json",
  "size": 1234,
  "digest": "sha256:..."
}
```

进一步推论：

- `path` 是 Bundle 内定位信息，`digest` 是内容身份，二者必须分开。导入器先规范化并校验路径，再读取确切字节验证 size/digest。[依据：OCI Descriptor 将 URL/定位与 digest/size 分开](https://specs.opencontainers.org/image-spec/descriptor/)
- ResourceManifest 应列全所有会影响运行的资源，包括指令文件、Skill 元数据与正文、references、scripts、Schema、平台扩展和适配配置；任何未列入 manifest 的文件都不应影响激活结果。[依据：OCI 以 descriptor 图承诺组成内容](https://specs.opencontainers.org/image-spec/)
- 可将 `bundleDigest` 定义为 `sha256(JCS(ResourceManifest))`。因为 manifest 已包含每个资源的摘要，这个根摘要传递性承诺整个资源集合。[依据：JCS 的可哈希表示](https://www.rfc-editor.org/rfc/rfc8785.html)；[OCI 的摘要描述符图](https://specs.opencontainers.org/image-spec/descriptor/)
- manifest 不能直接包含“对包含自身字节的摘要”而不规定排除规则，否则形成自引用。更简单的契约是把 manifest 摘要放在注册表记录、外层 envelope 或导出描述符中。[依据：OCI 使用外层 Descriptor 引用目标内容](https://specs.opencontainers.org/image-spec/descriptor/)
- 摘要不证明发布者身份。若需要来源与授权，还需签名、可信注册表或签名提交；不能把“hash 对得上”解释成“来源可信”。[依据：RFC 6920 安全考虑](https://www.rfc-editor.org/rfc/rfc6920#section-10)；[Anthropic 的 checksum 与签名提交建议](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise#versioning-strategy)

### 4.3 JSON 规范化

- **官方事实：RFC 8785 JCS 旨在生成可重复哈希的 JSON 表示。** 它要求 I-JSON 输入、禁止重复对象键、约束数字为 IEEE 754 双精度可表达值、不输出 token 间空白、递归排序对象属性并最终编码为 UTF-8。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)
- **官方事实：字符串不做 Unicode normalization。** JCS 要求保持解析后的 Unicode 字符串数据不变；其排序以原始未转义属性名的 UTF-16 code units 为基础，且与 locale 无关。[同上 §3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3)
- **规范地位说明。** RFC 8785 是 Informational RFC，不是 Internet Standards Track；采用它是本项目需要明确记录的技术选择，而非 JSON 或 JSON Schema 自动要求。[RFC 8785 Status](https://www.rfc-editor.org/rfc/rfc8785.html#section-1.1)

对应的**项目推论**：

- manifest 解析应拒绝重复键、无效 Unicode、NaN/Infinity 和超出选定数值模型的值；摘要必须基于 JCS 输出字节，而不是上传者原始排版字节。[依据：JCS 输入与序列化约束](https://www.rfc-editor.org/rfc/rfc8785.html#section-3)
- 资源文件本身仍按原始字节计算摘要。不要对脚本、Markdown 或 Schema 文件擅自换行/编码规范化，否则导入器验证的就不是发布者承诺的字节。[依据：OCI digest 对目标原始字节计算](https://specs.opencontainers.org/image-spec/descriptor/)
- 如需超过 IEEE 754 安全范围的整数，应在 manifest Schema 中把它们定义为十进制字符串，避免不同语言解析后得到不同规范化结果。[依据：JCS 对高精度数值的字符串建议](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.1)

### 4.4 可复现导入/导出

- **高可信工程事实：归档格式会泄漏环境差异。** 文件时间、条目顺序、用户/组与数值 ID、权限、ZIP extra attributes 等都会改变归档字节；Reproducible Builds 项目建议固定时间、稳定排序、固定 owner/group/权限并移除不必要元数据。[Reproducible Builds：Archive metadata](https://reproducible-builds.org/docs/archives/)

建议把验收标准拆成两级，均为**项目推论**：

1. **逻辑往返可复现（必须）：** `import(export(bundle))` 得到相同规范化 ResourceManifest、相同每资源 digest、相同 `bundleDigest`，不依赖临时解压目录、文件遍历顺序、locale 或联网结果。[依据：JCS 的平台无关可哈希表示](https://www.rfc-editor.org/rfc/rfc8785.html)；[JSON Schema URI 解析](https://json-schema.org/draft/2020-12/json-schema-core#name-base-uri-anchors-and-derefer)
2. **传输字节可复现（若产品要求）：** 同一 Bundle 重复导出得到逐字节相同的归档，因此 archive digest 相同。除逻辑规范化外，还必须固定条目顺序、路径分隔符、时间戳、owner/group、权限、extra fields、压缩算法/级别与工具兼容契约。[依据：归档元数据与排序的可复现性影响](https://reproducible-builds.org/docs/archives/)

建议的导入验证顺序：

1. 限制归档大小、条目数和展开后总大小，规范化路径并拒绝绝对路径、父目录穿越、重复规范化路径。[依据：JSON Schema 要求验证器防止不可信输入耗尽资源](https://json-schema.org/draft/2020-12/json-schema-core#name-security-considerations)
2. 读取 manifest，严格解析 JSON，按 manifest Schema 验证，并生成 JCS 字节核对外层 manifest digest。[依据：JCS 输入验证与规范化](https://www.rfc-editor.org/rfc/rfc8785.html#section-3)；[JSON Schema Validation 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation)
3. 按 manifest 逐项核对路径、媒体类型策略、size 和原始字节 digest；拒绝缺失资源、重复资源和未声明但会影响运行的资源。[依据：OCI Descriptor 的 mediaType/size/digest 验证](https://specs.opencontainers.org/image-spec/descriptor/)
4. 建立 `$id` 注册表，逐资源验证 Schema dialect/meta-schema，解析完整 `$ref` 闭包并执行循环/资源上限检查。[依据：JSON Schema Core 的标识、引用、meta-schema 与循环要求](https://json-schema.org/draft/2020-12/json-schema-core)
5. 校验 Skill 开放格式，再校验目标平台扩展与依赖；把可变版本选择解析成不可变 digest。[依据：开放 Agent Skills 校验](https://agentskills.io/specification#validation)；[Anthropic 生产版本固定建议](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise#versioning-strategy)
6. 仅在全部验证通过后原子激活 Bundle，并在运行记录中固定 `bundleVersion`、`bundleDigest`、目标平台和解析参数。[依据：Anthropic 生产部署/回滚/checksum 建议](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise#versioning-strategy)；[SemVer 发布不可变性](https://semver.org/spec/v2.0.0.html#spec-item-3)

## 5. 需要由项目继续决定的问题

以下问题是研究阶段暴露的选择面；本票已在
[Runtime Agent Bundle 领域契约与资源规范 §11](../specs/2026-07-20-runtime-agent-bundle-contract.md#11-外部规范调研问题的决议)
逐项作出决议，此处保留原问题作为决策证据。

1. **SemVer 的公共 API 边界是什么？** 是 ResourceManifest 结构、运行时行为、平台适配器契约，还是三者共同组成？不同答案会改变 MAJOR/MINOR/PATCH 判定。
2. **Bundle 逻辑身份是否正式采用 `sha256(JCS(manifest))`？** 若采用，需锁定 JCS 版本、hash 算法、manifest Schema 和数字表示约束。
3. **是否追求归档逐字节可复现？** 若只要求逻辑往返，导出实现可更简单；若要求 archive digest 稳定，必须把归档和压缩细节写入契约与测试向量。
4. **外部引用策略是什么？** 建议发布 Bundle 必须自包含，所有 Skill 引用、`@` 导入和 Schema `$ref` 都在 manifest 闭包内；若允许外部内容，应要求固定摘要与显式授权，且不能默认为联网获取。
5. **合法递归 Schema 的资源上限如何定义？** 需要选定 validator，并验证其 Draft 2020-12 dialect、`$dynamicRef`、循环保护和 `format` assertion 能力。
6. **跨平台资产采用“原生目录快照”还是“中立模型 + 适配输出”？** 本研究更支持后者，但必须保证不丢失原生层级、相对路径、平台扩展和冲突诊断。
7. **来源可信如何建立？** 内容摘要只验证完整性；若 Bundle 可来自不可信渠道，还需决定签名格式、信任根、撤销/轮换和注册表授权策略。

## 6. 一手来源清单

- OpenAI：[Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- OpenAI：[Build skills](https://learn.chatgpt.com/docs/build-skills)
- Anthropic：[How Claude remembers your project](https://code.claude.com/docs/en/memory)
- Anthropic：[Extend Claude with skills](https://code.claude.com/docs/en/slash-commands)
- Anthropic：[Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- Anthropic：[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Anthropic：[Skills for enterprise](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise)
- Agent Skills：[Specification](https://agentskills.io/specification)
- JSON Schema：[Core Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)
- JSON Schema：[Validation Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation)
- Semantic Versioning：[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)
- IETF/RFC Editor：[RFC 6920 — Naming Things with Hashes](https://www.rfc-editor.org/rfc/rfc6920)
- RFC Editor：[RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- Open Container Initiative：[Content Descriptor](https://specs.opencontainers.org/image-spec/descriptor/)
- Reproducible Builds：[Archive metadata](https://reproducible-builds.org/docs/archives/)
