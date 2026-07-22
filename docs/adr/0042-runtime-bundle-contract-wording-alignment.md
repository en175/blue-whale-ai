# ADR-0042：Runtime Agent Bundle 契约措辞与已实现行为对齐

- **状态**：Accepted
- **日期**：2026-07-22
- **决策者**：用户（与 Agent 诊断会话共同得出，触发事件：IK306O Agent Brief 审查发现契约措辞与已实现行为三处落差）

## 背景

工单 IK306O 审查 `docs/specs/2026-07-20-runtime-agent-bundle-contract.md` 时发现三处「契约措辞 vs 已实现行为」落差。逐行核实代码后确认双侧实现一致，问题只在文档：契约承诺了代码未实现的语义，或描述与代码不符。

1. **manifestDigest 算法**：契约 §3.3 / §11 声明 RFC 8785 JCS；双侧实际是「对象键递归字典序 + 数组保序 + 紧凑分隔符 + UTF-8」私房等价算法（`blue_whale_agent_worker/.../bundle/canonical.py::canonical_json_digest` 与 `RuntimeBundleDigests.java::canonicalize`），golden 测试用 Java IT 夹具（`pin_agent_v2_0_0` manifest）锁定 ASCII 键 + 整数值子集逐字节一致。
2. **commit 证据口径**：契约 §6 第 4 条要求回传「Bundle、ModelProfile、CreativeSkill 与资源摘要证据」；实现只回传资源级 `bundle_evidence`（`contracts.py::OrchestratorResult.bundle_evidence`，元素即 `gate.py::ReadEvidence` 五字段），无 pin 回显；pin 在 RunWork 下发时由 Java 固定（`AgentRunWorkerService.java#runPayload`），Worker 装载前 fail-closed 校验，Java 侧 commit 仅 `log.info` 不持久化。
3. **缓存篡改行为**：IK2QBP AC 字面「篡改触发失败」；实现是双层防御——缓存层（`cache.py::CachingBundleSource.fetch_resource`）静默丢弃脏项 + 回源自愈，权威层（`gate.py::ResourceGate._fetch_and_verify`）对 manifest 固化 `contentDigest` 抛 `BUNDLE_RESOURCE_DIGEST_MISMATCH` fail closed。

## 决策

### D1. manifestDigest 措辞对齐为私房等价算法

契约 §3.3 / §11 删除「RFC 8785 JCS」承诺，改述为双侧实际的等价规范化（对象键递归字典序：Python `sort_keys=True` / Java `Comparator.naturalOrder()`；数组保序；紧凑分隔符 `,` / `:`；UTF-8；SHA-256；`sha256:` 前缀），并显式声明确定性前提（schema 数值字段全 `integer`、键集封闭、键全 ASCII）。根因：双侧从未实现真 JCS，长期是一份私房等价约定，文档虚标外部标准制造认知债务。放宽任一确定性约束（浮点字段 / 非 ASCII 键 / 非 BMP 键）会使 `json.dumps` 与 Jackson 分叉，须 MAJOR 双侧重对齐。锚点：`canonical.py`、`RuntimeBundleDigests.java`、`docs/specs/runtime-agent-bundle.schema.json`。

### D2. commit 证据口径拆为两层

契约 §6 第 4 条拆为：(a) 资源读取证据 `ReadEvidence` 随 commit 以 `bundle_evidence` 回传、Java 仅 `log.info` 不持久化、另经 `requestDigest` 进幂等哈希（反重放）；(b) Bundle / ModelProfile / CreativeSkill pin 不回传，由 Java 在 RunWork 原子固定、Worker 装载前 fail-closed 校验。根因：载荷只含 `bundle_evidence`，pin 回显无安全收益；Worker 是资源装载唯一知情者，证据边界止于资源级。锚点：`contracts.py::OrchestratorResult`、`gate.py::ReadEvidence`、`AgentRunWorkerService.java#commit`。

### D3. 缓存篡改表述为双层防御

IK2QBP AC「篡改触发失败」由双层承载并写入契约：缓存层（加速器，非权威）静默丢弃脏项 + 回源自愈，权威层（ResourceGate）对 manifest 固化摘要 fail closed。根因：缓存是性能优化，磁盘损坏 / 篡改属基础设施故障，不应升级为运行时失败；权威校验只属于装载闸门，职责分离。锚点：`cache.py::CachingBundleSource`、`gate.py::ResourceGate`、`verifier.py::BundleVerifier`。

## 备选方案与不采纳理由

- **双侧换真 RFC 8785 JCS 实现**：破坏既有发布快照的 `manifestDigest` 身份（已落库快照摘要会变），属 MAJOR 破坏性变更，超出本工单「纯措辞对齐」范围。
- **Worker 补 Bundle / ModelProfile / CreativeSkill pin 回显**：无安全收益（pin 已由 Java 权威固定），且违反 ADR-0041 D3「不在功能工单里夹带契约字段变更」——回显字段即契约形状变更。
- **缓存层 fail closed**：把磁盘损坏 / 索引丢失等基础设施故障升级为运行时失败，与「缓存是加速器」定位冲突，降低可用性而无正确性收益（权威层已 fail closed）。

## 后果

- 正面：消除三处「文档承诺 vs 代码实现」认知债务；schema 确定性前提显式化，未来放宽约束有明确升级路径（MAJOR 双侧重对齐）。
- 代价：契约 §3.3 / §11 的「JCS」字样消失，依赖该字样的外部引用需更新；本 ADR 提供迁移依据。
- 代码零改动：`canonical.py` / `RuntimeBundleDigests.java` / `gate.py` / `cache.py` / `verifier.py` / schema 文件均不动，双侧实现与契约措辞已逐字对齐。
