# 身份域表名与索引名前缀收敛到 bw_

- 状态：已采纳
- 日期：2026-09-28
- 决策者：lixq（会话中拍板）
- 取代：[ADR-0117](0117-table-naming-and-module-prefix.md) §2 的 `identity_` 前缀
- 关联：[ADR-0114](0114-new-api-as-upstream-identity-and-billing-services.md)、[ADR-0084](0084-generation-worker-java-runtime.md)（改名须联动检查 worker-java mapper 的既有约束）

## 背景

ADR-0117 §2 定了「前缀 = 限界上下文 = 未来库名」，前缀空间收敛为 `identity_` / `billing_` / `generation_`，六张身份域表据此落地为 `identity_users` / `identity_verification_codes` / `identity_memberships` / `identity_roles` / `identity_user_roles` / `identity_login_logs`。

落到实处的体验与当初的三处假设有出入：

1. **`identity_` 不自解释。** 仓库是共库的（同一个 MySQL 实例里还有 `blue_whale_pay`、`new-api`、`bw_billing`）。`identity_users` 只说明「这是身份的表」，说不出**是谁的**——共库时后者才是真正要找的信息。本产品的库、只读账号、会话 cookie 早已统一用产品前缀 `bw_`（`bw_billing` / `bw_readonly` / `bw_session`），表名是唯一没跟上的。
2. **分库没有时间表。** §2 的全部收益押在「分库那天表名不用改」。分库未排期，这笔收益无限期兑现不了，而自解释性从第一天起就要用。
3. **改名成本比预期高。** ADR-0117 认为 `@@map` 能把模型名与表名解耦、TS 侧零改动；实测本仓模型名一律等于表名（`schema.prisma` 全仓零 `@@map`），改名必须连 `prisma.<表>` 的调用点一起改。

## 决策

1. **六张身份域表由 `identity_*` 改为 `bw_*`**：`bw_users` / `bw_verification_codes` / `bw_memberships` / `bw_roles` / `bw_user_roles` / `bw_login_logs`。迁移 `20260928100000_bw_prefix_rename`，一条多表 `RENAME TABLE`（MySQL 的多表 RENAME 是原子的，不会停在改了一半）。
2. **这六张表上的索引同步改名**，按 ADR-0117 §3 的 `uk_{表}__{列}` / `idx_{表}__{列}`：九个 `uk_identity_*` / `idx_identity_*` → `uk_bw_*` / `idx_bw_*`。
3. **不含 `identity_` 前缀的索引保持原名**：`idx_phone`、`idx_ip_created`、`idx_phone_created`、`idx_phone_unused`。它们是 baseline 带进来的，名字不由我们的迁移决定。
4. **`billing_` / `generation_` 前缀不动。** ADR-0117 其余条款——表名一律复数、外键 `{单数表名}_id`、关联表用 `_` 连接、索引命名规范、不改其余约 30 张业务表、同名词分裂靠注释划边界——全部继续有效。
5. **改索引名前必须用 `SHOW INDEX` 核对目标库的实际名字。** ADR-0117 曾以「猜错就不可重入」为由把索引改名推迟；本次核对本地库与测试站两个真实库后确认这九个名字是确定的（都由我们的迁移显式命名，两库逐字一致），该理由不成立，故一并整改。今后新增索引改名仍按这条先核对。
6. **规划中但尚未建表的 `identity_*` 名字随之统一为 `bw_`**（文档里的 `bw_linked_accounts` / `bw_external_refs` / `bw_admin_logs` / `bw_map`）。它们是规划名，真正建表时以当时的评审为准。

## 被否决的备选

- **保留 `identity_`，靠注释说明边界。** 注释不出现在慢查询日志、`SHOW TABLES` 和临时排查的 `information_schema` 查询里——而那正是需要自解释的地方。
- **只改表名、索引名留着。** 会留下 `bw_users` 上挂着 `uk_identity_users__email` 的半吊子状态，下一个读到的人还得重走一遍「这是漏改还是有意」的判断。
- **连 `billing_` / `generation_` 一起改成 `bw_`。** 那会丢掉未来分库时最有价值的信息：哪些表该一起搬走。身份域改用产品前缀，正是因为它本就没有独立分库的计划。

## 后果

- **正向**：库表清单、慢查询日志、临时排查一眼看出归属；与 `bw_billing` / `bw_readonly` / `bw_session` 同一套命名。
- **成本**：一次迁移（6 张表 + 9 个索引）；26 个 TS 文件的机械替换（21 个非测试 + 5 个 parity 测试）。迁移前已核实 `worker-java` 不碰这六张表、billing 走 gRPC 不读本库，Java 侧零改动。
- **风险**：`RENAME INDEX` 没有 `IF EXISTS`，目标库若与核对过的两库不同形会失败。迁移内附 pre-flight 查询，多出或少一行时**先停下查清，别直接跑**。
- **遗留**：核对时发现测试站 `identity_users` 上另有 `idx_users_username` / `username` / `username_2` 三个同列冗余索引（本地库没有，`users` 时代遗留、走的是另一条建库路径）。本次不动它们——删索引是独立决策，不搭这次改名的车。
