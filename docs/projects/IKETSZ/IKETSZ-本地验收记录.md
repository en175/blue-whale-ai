# IKETSZ 共享引用移除、失效与修复

## 时间

2026-09-11

## 背景与基线

依据 IKE5G8 规格第 6、7 节和 IKETSZ 验收清单，在独立任务工作区实现从目标移除方案、单目标断线与失效恢复。基线为本地 release/2026.09.15 的 3212e850bdb10470443b0017bf9bccbb7e246d73，包含 IKETSX、IKETSY；不代表部署或真实 Agent 联调完成。

## 行为与实现

- 图片、视频 Dock 的方案附件增加“移除方案”。一次操作释放该方案在当前目标的来源，独占媒体边随之移除；手动和其他方案来源保留，素材卡与其他目标不变。
- Canvas 保存与前端共享 releaseRemovedPromptSources 规则，沿用 inputSources 的 manual、planNodeIds，不新增持久化字段。只释放移除来源，不自动重建用户断开的媒体边。
- 方案附件移除和 Dock 断线进入连线撤销记录；撤销、重做恢复完整来源信息。整张方案节点删除也在前端同步释放来源，删除记录携带完整连线前后状态，避免后续保存将独占边重新写回。
- 沿用前置票的逐目标校验、方案标签编辑与同步、接纳快照。真实资产删除沿用资产库入口；刷新后显示失效占位，生成 API 再次验证权限与存在性。
- 手动恢复连线会建立手工来源；删除方案标签并同步不会自动删除该来源。手工素材已失效时，须显式“移除失效参考”才可生成。

## 验证边界与复现

真实 Chromium、Vite、NestJS Canvas/Assets/Generation/Jobs API、Prisma 和独立 MySQL 数据库 iketsz（127.0.0.1:23416）参与。外部 Agent、账户和供应商使用既有记录式测试替身。权限丢失通过隔离数据库夹具制造，再由公开生成 API 校验；真实删除走资产库 UI 与 DELETE /api/assets/:id。

```bash
IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsz \
IKETSZ_BROWSER=1 IKETSY_BROWSER=1 IKETSW_BROWSER=1 IKETSX_BROWSER=1 \
pnpm exec vitest run \
  backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts \
  backend/libs/shared/generation/handle-create-generation-job.test.ts
```

新增覆盖共享来源清理及刷新、图片与视频 Dock 移除、A 断线不影响 B、手动连线修复、撤销/重做、资产库真实删除、编辑标签并逐目标同步修复。公开接口补充缺线绕过、权限丢失、删除后的拒绝、逐目标确认与历史快照不变。修复后视频任务通过真实 TS worker 调用记录式 HTTP 供应商，检查最终正文和空素材输入，并回读任务成功状态。未验证 MQ 自动派发或 Java 执行器，本票未修改这些路径。

首次公开 API 测试在独占媒体边未清理处失败，实施共享释放规则后通过。初轮完整回归 104 项通过、1 项旧浏览器开关用例未开启；仓库选择器得到 scoped VERIFIED。审查随后发现整张方案删除的前后端状态不一致，新增真实浏览器用例先在残留两份素材处失败；修复后验证连续保存和刷新不再写回独占边。最终收口凭证须重新绑定修复后的干净 HEAD。

## 双轴审查

Standards：初轮硬违规 0，可行动 smell 0。

Spec：初轮实现问题 1 项（上述整张方案删除的保存一致性），已修复并补回归；实际 Agent 联调与人工 UI 仍属于未完成验收，不以本地自动化替代。最终复核以任务完成报告为准。

## 待完成验收

实际 Agent 联调环境尚未提供；人工 UI 操作验收尚未执行。自动浏览器结果不替代这两项证据，因此保持 IKETSZ 进行中，不关闭本票或母需求。本次仅落本地任务提交，不推送、开 PR、合入 release 或部署。
