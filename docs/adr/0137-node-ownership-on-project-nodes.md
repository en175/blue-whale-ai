# ADR-0137：节点归属落在 `project_nodes`，删除 `generation_canvas_node_owners`

- **状态**：已采纳
- **日期**：2026-10-28
- **决策者**：lixq
- **关联**：[ADR-0125](0125-protected-item-guard-anchors-on-node-owner.md)、[ADR-0132](0132-canvas-recovery-align-not-validate.md)、[ADR-0134](0134-project-prefix-and-canvas-node-tables.md)、IKQY3H / IKQWV1

## 背景

IKJJQU 的生成恢复契约把节点归属放在独立表 `generation_canvas_node_owners`（提交流、输出键、承接版本），受理时锁该行并比对版本。IKQY33 引入 `project_nodes` 行表后，同一个节点在两张表各有一份状态，读路径还要多一次 JOIN；节点软删时归属行的生命周期也与节点行脱节。

## 决策

1. `generation_canvas_node_owners` 的三列并入 `project_nodes`：`owner_submission_id`、`owner_output_key`、`owner_binding_revision`。
2. 读归属统一走 `loadRecoveryOwners`：节点行归属列优先（包含软删行）；节点行不存在或未写归属时，按 `generation_canvas_submissions` 的最新提交与 `generation_canvas_outputs` 是否已有 PRIMARY 输出推导。`result-placeholder` 目标在受理时可能尚未落行，推导保证同版本第二次意图仍冲突。
3. 受理仍先锁 `project` 与 `project_canvas` 行，再读归属；节点行存在时归属列在受理事务内写入，否则由推导兜底。节点软删只置 `is_delete`，归属列与承接版本保留。
4. 整份保存（`saveIfVersion`、`saveCanvasWithRecovery`）改为写 `project_nodes` / `project_edges` 并置 `rows_authoritative=1`，不再写 `nodes_json` / `edges_json`；这样行表权威开关打开后，旧客户端的整份保存也不会被读路径忽略。
5. 迁移拆两步：082 加列并搬运已有节点行的归属；083 再补搬、为已开启行表的项目中「归属存在但节点行不存在」的记录写软删占位行，最后删表。083 的占位写入只针对 `rows_authoritative=1` 的项目，避免在没有节点行的项目上制造 `rows_without_marker` 状态。
6. 运行期恢复保存遇到「需要写归属但节点行还不存在」（如从未落卡的虚拟结果节点）时，在同一事务内先置 `rows_authoritative=1`、写完整文档，再补一条 `is_delete=1` 的占位行承载归属三列。软删且带 `owner_*` 的行是合法状态，读路径（含归属仲裁）会保留它，清理任务不得把它当垃圾删除。

## 后果

- 上线顺序：部署新镜像并执行 082 → 完成 IKQY3D 回填 → 执行 083。回填已完成时可以 082/083 一起执行。
- 083 删除归属表是单向操作；回滚镜像需要按 060 重建该表，迁移执行前应先备份。
- 受理不再对归属行做 `FOR UPDATE`；并发由 `project` 行锁串行化，同版本两个意图仍只有一个进入计划。
- `project_nodes` 的 `owner_*` 列只在节点行存在时写入；未落行目标依赖推导，保存路径会补软删占位行（见决策 6）。
- 节点列表缩略图与场景卡定位读取行表（marker=1 时），避免继续读旧的 `nodes_json`。
- 行表读取按 `project_nodes.id`（创建顺序）返回节点，旧 JSON 保留客户端数组顺序；节点数组顺序不再作为契约，前端不得依赖数组序表达层级或层级内的 z 轴。
