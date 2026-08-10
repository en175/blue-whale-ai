# IK67HJ（T18）确定性层验收证据：五类退役门禁 + 全栈黑盒 + 数据库清单

> **状态：历史局部证据，不构成 T18 最终验收。** 确定性层与真实层执行于不同提交，未满足“同一不可变发布候选、证据不得跨版本拼接”。IK7EU4 真实 Agent provider 已合入主线，但尚未产生对应的真实 Agent canary 证据；最终候选须以同一干净 commit 重跑全部门禁与 canary。

- 日期：2026-08-09
- 历史运行版本：确定性层 `b251e837`；真实层 `b5641c5e`（两者均不是当前分支最终 HEAD 的祖先）
- 验收镜像摘要：`blue-whale-typescript-baseline:acceptance` = `sha256:28a0b3595587fc900c3f03a9a69853478d7a98fa3701e04259409ab62b4aa2a0`
- 执行人：AI Agent（人工授权范围内执行；docker 旧镜像/容器清理获单独授权）
- 执行环境：本机 macOS + Colima（Docker），worktree `../blue-whale-worktrees/chore-ik67hj`

## 历史版本关系（审查后判定不满足候选锚定）

- 确定性层全链 `pnpm verify` 执行于 commit `b251e837`（2026-08-09 14:58–15:17 CST 单次跑通）。
- `b251e837` 与 `b5641c5e` 的相关产品代码、验收测试和 runner 虽无差异，但规格明确禁止跨 commit 拼接证据，因此该差异证明不能替代同一候选重跑。
- 真实层 canary 执行于 `b5641c5e` 干净树（`dirty=false`，见真实层证据文档内嵌的锚定行）。

## 安全边界

- 全程本地闭环：验收拓扑（docker compose `bw-ts-baseline-acceptance`）使用确定性 fake provider / storage stub，无真实计费。
- 未连接测试站、未触碰任何远程环境；无凭证写入本文档。
- 目标环境门禁中的旧 docker 镜像/容器清理（12 镜像 + 2 已退出容器，Java 栈时代产物）经人工逐项授权后执行，明细见「目标环境门禁」节。

## 脱敏结果

### 历史门禁结果（仅保留事实，不代表最终候选通过）

| 门禁 | 实现 | 结果 |
| --- | --- | --- |
| 源码 | `tests/typescript-baseline/no-java-runtime.test.mjs`（8 个旧栈符号零命中 + `blue_whale_server`/`blue_whale_agent_worker`/`apps/product-api`/`deploy/local` 四目录物理缺席） | PASS |
| 构建 | `verify-typescript-baseline.sh` 链：Node v24.18.0/pnpm 11.17.0 版本闸 → `tsc -b --force` + web `tsc --noEmit` → `tsc -b` 构建 → vitest 全量 → `next build` + worker 打包，各步退出码 0 | PASS |
| 语义 | Node-only 全栈黑盒 16 套件（见下「主场景覆盖」），合计 122 项断言全绿、0 失败 | PASS |
| 拓扑 | `fullstack.test.mjs` 验收拓扑测试组：单镜像双进程、三进程就绪、worker 独立重启恢复；compose 栈仅 Node 服务 + mysql/redis/new-api | PASS |
| 目标环境 | `scripts/check-target-environment-retirement.sh`：旧进程/旧镜像/旧容器/旧端口/旧环境变量/旧可执行引用六项；该次实跑无 SKIP。审查后脚本已改为任一 SKIP 即 INCONCLUSIVE（退出码 2） | 历史 PASS（6/6） |

目标环境门禁执行备注：首跑发现 12 个旧 docker 镜像（blue-whale-gateway/user/agent/agent-worker 的 :local/:acceptance 等 + nacos-server）与 2 个已退出旧容器（bw-agent-worker、bw-schema-migration），属 T17 退役清单的物理残留；经人工授权 `docker rm`/`docker rmi` 清理后复跑 6/6 PASS。清理动作超出 AC#6「检查确认」字面语义，属退役收尾修复，已获单独授权。旧端口清单提取自退役前 compose（`git show 8ac52b7d^:deploy/local/docker-compose.yml`：8686/8081/8082/8848/9848/9849）。

### 确定性黑盒主场景覆盖（验收标准九类 → 套件映射）

| 主场景 | 覆盖套件 | 结果 |
| --- | --- | --- |
| 上传 | composer-upload-blackbox | PASS |
| 显式引用 | mention-blackbox + mention-input-snapshot-blackbox（本票挂链） | PASS |
| 澄清 / 最终确认 | scenario-blackbox（含 awaiting_final_confirmation）+ conversation-browser-blackbox | PASS |
| 混合 PlanMessage | plan-message-blackbox（本票挂链：多卡 image_generate+scene_card_create 原子提交、replace 独占） | PASS |
| 独立应用 | plan-apply-blackbox（本票挂链：首图手动应用闭环）+ plan-application-blackbox | PASS |
| 停止/重试 | scenario-blackbox + output-slot-retry-blackbox + snapshot-recovery-blackbox | PASS |
| Worker 接管 | scenario-blackbox（租约接管）+ snapshot-recovery-blackbox | PASS |
| Snapshot/SSE 恢复 | snapshot-recovery-blackbox（SSE 断线续传、三进程重启最终一致）+ conversation-browser-blackbox | PASS |

### 数据库清单（新鲜环境）

- `pnpm db:fresh` 全量重建：`SHOW TABLES` = 43 张表，与 `fullstack.test.mjs` 白名单逐表 `deepEqual` 一致（admin_operation_logs … verification_codes，完整清单见测试断言）。
- 关键列抽查：`assets.duration_ms`、`assets.storage_key` 存在（列级全量对照以 fullstack 白名单断言为准，本文档为抽查）。
- 种子：`generation_model_capability` 启用能力恰 3 条（seedream 图 / seedance 视 / MiniMax-M3 文本），init 脚本种子计数断言通过。
- 新鲜库仅从单一 TypeScript baseline（`packages/persistence/schema/001_baseline.sql` + `002_seed.sql`）初始化，不要求历史 Java/Python migration（001 头部注释声明 "No compatibility or data migration from the retired Java V1-V18 chain"）。

## 结论

- 历史运行观察到：确定性层、目标环境门禁与数据库清单各自通过。
- **最终结论：INCOMPLETE。** 这些结果未执行于同一不可变候选，不能作为 T18 通过证据。
- 最终重跑前置：候选包含已合入主线的 IK7EU4；候选驱动校验运行服务 commit 等于干净仓库 HEAD；全部结果发布后不得再 amend 候选。
