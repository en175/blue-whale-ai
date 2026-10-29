# IKQY3G 画布存储改造回归与读取效率对比（2026-10-28）

## 环境

- 本地 Docker MySQL `bw-mysql`（`127.0.0.1:13306`），库 `bw_gate_ikqy3h`，按 `prisma/schema/*.sql` 顺序重放并执行 081、082、083。
- 15 个恢复/媒体工具套件**串行**执行；它们共用同一 `PROJECT_ID`，并行会互相清理夹具。
- Vitest 单文件运行，未设置 `IKQY3G_NODES` 时 benchmark 默认跑 200 与 1000 节点两档。

## 回归结果

| 套件 | 结果 |
| --- | --- |
| ikjjqy-canvas-recovery | 25 passed |
| ikjjqw-media-tool-recovery | 55 passed |
| ikjjqz-mix-mux-canvas-recovery | 11 passed |
| ikjjr0-canvas-recovery | 10 passed |
| ikjjqu-canvas-recovery | 10 passed |
| ikjlts-canvas-recovery | 8 passed |
| ikjlpc-canvas-recovery | 7 passed |
| ikjku2 / ikjku8 / ikpd88 | 6 / 4 / 6 passed |
| iklbuf / ikjltt / ikkbl9 | 4 / 5 / 4 passed |
| ikjlxe-canvas-recovery | 3 passed |
| ikjltx-media-tool-replay | 36 passed |
| **合计** | **194 passed** |

本轮修复的夹具问题：`prisma.assets` 旧模型名、媒体工具 `create` 多传内部参数、混合/合成 `retry` 第 5 参错位导致 binding 被丢弃、素材缺宽高/时长/分辨率、行表写入后仍断言旧 JSON、跨用例残留行、节点数组顺序断言。生产侧的补充修复是恢复保存为「尚未落卡的结果节点」补软删归属占位行，`ikjlts` ★5 在修复前会 409。

## 读取效率对比

同一库、同一进程、`createCanvasRepo.getByProject` 各读 30 次，中位数：

| 节点 / 连线 | JSON（marker=0） | 行表（marker=1） | 返回数据量 |
| --- | --- | --- | --- |
| 200 / 199 | 1.95 ms（min 1.59 / max 6.51） | 5.22 ms（min 4.39 / max 13.87） | 47,003 B |
| 1000 / 999 | 5.58 ms（min 4.92 / max 15.28） | 15.64 ms（min 14.28 / max 18.72） | 239,103 B |

结论：在本地 MySQL + Prisma、无进程重启与缓存隔离的条件下，行表读取比 JSON 慢约 2.2–2.7 倍，返回数据量一致。行表的收益是节点级检索、归属仲裁与增量写入，不是读取速度；本报告不承诺提速比例。

## 已知边界

- 节点数组顺序按 `project_nodes.id`（创建顺序）返回，不再保留客户端数组顺序；前端不得依赖数组序表达层级或 z 轴（见 ADR-0137）。
- 混合/合成历史任务若没有冻结的时长/分辨率，重试仍会被拒绝；本轮只让夹具覆盖「已冻结」的存量任务。
- 双窗口旧版本保存由 `If-Match` 条件写与 412 语义覆盖，单测保留；真库双窗口演练未在本轮执行。
