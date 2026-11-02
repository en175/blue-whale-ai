# ADR-0138：退役旧生成卡迁移与 `project_card_migration_history`

- **状态**：已采纳
- **日期**：2026-10-29
- **决策者**：lixq
- **关联**：[ADR-0132](0132-canvas-recovery-align-not-validate.md)、[ADR-0136](0136-billing-ops-prefixes-and-command-receipts.md)、[ADR-0137](0137-node-ownership-on-project-nodes.md)、IKRCIO / IKQWV1

## 背景

历史画布里存在「旧生成卡」：`assetNode` + `data.kind="generation"`，带有 `generationCard`（标题、提示词、画面描述、来源）。旧逻辑在打开画布（GET）或首次导入行表时把它替换成提示词卡（`textNode`），并把原卡内容写入 `legacy_card_history`（IKQY3O 后改名 `project_card_migration_history`）以便去重、冲突判断和保留原件。该表按 180 天保留期清理。

画布存储已切到行表（IKQY3D/IKQY3H），新画布不再产生旧卡；旧卡迁移成为只服务存量数据的过渡链路。

## 决策

1. 产品确认（2026-10-29）**不再保留历史旧卡数据**：不迁移、不备份、不提供回滚。
2. 删除旧卡迁移链路：转换函数、历史仓储、GET 侧迁移调用、`GET /api/canvases/:projectId/legacy-card-history`、导入器里的旧卡转换分支、清理脚本与契约类型；前端同步移除迁移历史弹窗、提示与查询。
3. 删除 `project_card_migration_history` 表；084 迁移同时 `DROP IF EXISTS` 更早的 `legacy_card_history`，避免未执行 079 改名的环境静默漏删。
4. 发布顺序：所有新镜像（backend/web/worker）就绪后再手工执行 084；本仓镜像不自动执行迁移（见 `backend/prisma/README.md`）。084 之后旧镜像不可再启动。

## 后果

- 仍未迁移的画布里，旧生成卡保持 `assetNode` + `data.kind="generation"` 原样，前端按普通素材卡/空卡呈现，不再自动转换。
- 画布 GET 与快照读取不再写库，读路径副作用消失；响应不再包含 `legacy_migration` 字段。
- ADR-0136 中关于该表 180 天保留期与清理脚本的条款由本 ADR 取代；历史迁移 SQL（019/079）、历史契约文档与历史 ADR 保持原样作为记录。
