# IKETSY 方案编辑与多目标同步验收

## 时间

2026-09-11

## 目标与基线

在 `feature/IKETSY-方案编辑多目标分别同步` 独立工作区交付方案文字、素材标签编辑和逐目标同步。开工入口建立工作区后，快进至本地 release/2026.09.15 的 `52a89ca460d5cd4fff7c8d011ff948b5983d1237`，包含已完成的 IKETSW/X；本票变更范围以该 SHA 为基准。

## 用户行为

- 选中方案，点击正文素材标签后可替换或删除；新增标签从画布中按明确 assetId 选择，包括原本没有素材的纯文字方案。
- 当前正文与标签自动保存；纯文字修改直接用于下一次生成。素材绑定变化后，每个目标独立显示待同步、禁止发送。
- 在某个目标 Dock 点击“同步素材到目标”，仅修改该方案到该目标的确认状态和媒体来源。手动与其他方案来源保留，独占旧引用被移除，画布素材卡不删除。
- 版本或绑定过期、素材缺失或模型超限时原子拒绝；保留当前编辑，不把旧确认套用于新绑定。历史任务不受编辑和同步影响。

## 验证与复现

真实 NestJS Canvas/Generation/Jobs API、Prisma、独立本地 MySQL 数据库 `iketsy`（127.0.0.1:23416）及真实浏览器参与。外部 Agent、账户服务、供应商使用原有测试替身；没有替换业务 API。

```bash
IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsy \
IKETSY_BROWSER=1 IKETSW_BROWSER=1 IKETSX_BROWSER=1 \
pnpm exec vitest run \
  backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts \
  backend/libs/shared/generation/handle-create-generation-job.test.ts
```

定向回归 101 项通过，1 项原有浏览器开关用例未开启。新增 API 覆盖纯文字首次加素材、伪造元数据拒绝、逐目标确认、共享来源保留、删除全部标签、模型超限、素材失效、过期版本/绑定、并发保存与同步只有一个成功，以及当前正文和旧任务快照。

新增浏览器覆盖替换、删除、新增标签、A 同步后 B 仍禁用生成、刷新恢复、草稿不覆盖。另用请求延迟（继续发送真实 HTTP，不伪造响应）制造同步在途时另一客户端保存，确认旧同步返回 412，当前编辑保留且仍阻止发送。

独立 Web 与 Backend 类型检查通过。最终收口依照 `docs/agents/testing-strategy.md`，运行选择器 `run/check --base 52a89ca460d5cd4fff7c8d011ff948b5983d1237`，以绑定最终干净 HEAD 的凭证为完成依据。

## 双轴审查

Standards：最终剩余发现 0 项。采纳共享 PromptBinding 类型复用建议。

Spec：最终剩余发现 0 项。审查发现“新增后立即删除标签保存失败”和“新增标签导致超限后缩短仍无法保存”两项恢复缺陷，分别补公开 API 和真实浏览器失败用例，修复后通过并经独立复核。编辑草稿保留新增素材展示元数据；即使标签在保存前移除，合法元数据仍经过素材身份、权限、类型、URL 与事务校验。

## 交付边界

本次停在本地任务提交和审查；未推送、创建 PR、合入 release、部署或关闭母需求。自动浏览器验收不等同于人工 `dev:test` 操作体验验收。Java 执行器没有本票修改，沿用 IKETSX 的快照消费；本票未重复进行 Java 端到端验证。
