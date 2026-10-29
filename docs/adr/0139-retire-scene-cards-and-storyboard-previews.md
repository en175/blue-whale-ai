# ADR-0139：退役场景卡与分镜预览

- **状态**：已采纳
- **日期**：2026-10-29
- **决策者**：lixq
- **关联**：[ADR-0026](0026-generation-output-slots.md)、[ADR-0120](0120-generation-job-extensions-and-column-ratchet.md)、[ADR-0137](0137-node-ownership-on-project-nodes.md)、IKRDNK

## 背景

场景卡（SceneCard）与分镜预览（StoryboardPreview）是「Agent 写出计划卡 → 应用成场景卡 → 从场景卡发起图片/视频生成」这条流水线的产物。计划通道已在 IKCKOW / IKD806 退役，写路径陆续删除；`scene_card_generation_records` 的两列溯源字段在 057 放宽为可空后也再无写入方。

实际运行状态：测试站四张相关表分别只有 5 / 1 / 1 / 1 行历史数据，生产侧无活跃使用；画布节点与共享资产里的场景卡引用都停留在历史数据。产品确认场景卡功能下线，后续如需要重新设计。

## 决策

1. 删除四张表：`scene_card_generation_records`、`scene_card_generation_presets`、`storyboard_previews`、`scene_cards`；同时删除 `generation_output_slots.scene_card_generation_record_id` 列与 `idx_slot_record` 索引（两者只服务场景卡聚合回写）。
2. 删除后端对应能力面：`scene-cards` 与 `scene-card-generate` 两组控制器、`scene-card` 模块与仓储、分镜预览的创建与仓储、素材库 `scene` 保存策略与「添加回项目」路由、会话 mention 的 `scene_card` 变体、快照投影里的三组场景卡字段。
3. worker-java 同步拆除：`SceneCardGenerationRecordSync`、`StoryboardPreviewSync` 及其实体与 mapper；`JobFinalizer` 只保留终态写入，不再回写聚合摘要。
4. 前端删除 `api/sceneCards.ts`、素材面板的场景卡「添加回画布」分支、`scene` 节点工厂分支、mention 的 `scene_card` 变体。
5. 保留三处只读兼容：
   - 共享资产里已经存下的 `assetType=scene` 历史条目仍可列出与查看（类型枚举、快照 schema、面板预览保留），但不能再保存新条目、不能添加回画布；
   - 画布中已存在的 `scene_card` / `storyboard-frame` 节点数据不清理，旧画布照常打开；
   - `plan-message` / `context-projection` / `plan-application` 契约中的 `scene_card` 与 `storyboard_frame` 变体保留（Agent 侧存活契约，非本单改动面）。
6. 生成任务的 `source` 取值 `scene_card`、`storyboard_preview` 在领取白名单里保留：历史排队任务仍能被领取并走完通用生成路径，不会因过滤条件收紧而滞留在队列。

## 后果

- **上线顺序**：先部署新 backend **与 worker-java** 镜像，再执行 085 迁移。旧 worker-java 与旧 backend 的终态路径会无条件查询 `storyboard_previews` 做摘要回写，表被提前删除后每个任务的 finalize / fail / cancel 都会抛错，任务卡在非终态；`generation_output_slots` 的列删除同样要求新镜像先生效。
- 085 是单向操作：四张表与其历史行不可恢复；回滚镜像需要按 001 基线重建表结构，迁移前应备份。
- `generation_output_slots` 写入方（backend）与读取方（worker-java）不再引用被删列，Java 测试 schema 同步删除对应建表语句。
- 分镜预览专用的恢复集成测试用例（IKJJR0 的 S1–S5）随被测接口删除；同一文件里的 R1–R5 验证的是仍然存活的 `generation.create` 视频样片受理与预扣补偿，已迁到 `ikjjr0-generation-create-recovery.integration.test.ts` 保留。
- 共享资产列表接口仍接受 `assetType=scene` 过滤，历史条目在面板里显示为只读；新增保存请求返回 400。
