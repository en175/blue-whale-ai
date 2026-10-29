# ADR-0135：目录 / 素材 / 内容前缀与表归位

- **状态**：已采纳
- **日期**：2026-10-27
- **决策者**：lixq
- **关联**：[ADR-0117](0117-table-naming-and-module-prefix.md)、[ADR-0134](0134-project-prefix-and-canvas-node-tables.md)、IKQY3N / IKQWV1

## 背景

ADR-0117 §2 把前缀空间收敛为 `identity_ / billing_ / generation_`，§6 明确「三个 skill、三个 asset 的同名词分裂不改名」。实际使用下来，同名词造成的检索歧义比改名成本更贵：`assets` 同时指用户资产、素材镜像、共享快照；`skill` 同时指目录技能、用户技能、创作技能。这些表分属不同写入方与生命周期，却没有一个能自解释的名字。

本票与同批次的 [ADR-0134](0134-project-prefix-and-canvas-node-tables.md) 一起，把「前缀 = 归属域」从只覆盖三个域扩展到本批次涉及的业务表。

## 决策

1. 新增三个前缀：`catalog_`（只读目录/配置）、`user_`（用户自有数据）、`content_`（运营内容）。
2. 14 张表改名：
   - `assets` → `user_assets`
   - `shared_assets` → `user_shared_asset_snapshots`
   - `material_groups` → `catalog_material_groups`
   - `material_assets` → `catalog_material_states`
   - `generation_model_capability` → `catalog_models`
   - `media_tool_pricing` → `catalog_media_tools`
   - `skill` → `catalog_skills`
   - `user_skill` → `user_skills`
   - `creative_skill` → `catalog_creative_skills`
   - `creative_skill_version` → `catalog_creative_skill_versions`
   - `template_card` → `catalog_templates`
   - `template_card_image` → `catalog_template_images`
   - `template_tag` → `catalog_template_tags`
   - `homepage_hero` → `content_homepage_heroes`
3. 只改嵌入完整旧表名的索引（8 条）。`idx_asset_*`、`idx_hero_*`、`uk_name` 等不含旧表名的索引保持原样；按列命名的 `uk_skill_code`、`idx_skill`、`uk_tag_code` 同样不动——它们描述的是列，不是表，避免把一次表归位扩成全库索引收敛。
4. `002_seed.sql` 保持旧表名：本仓没有自动迁移执行器（`migrate deploy` 被禁），`001_baseline.sql` 与 `002_seed.sql` 是互相配套的归档/建库产物，按 baseline → seed → 编号迁移的顺序重放时，改名由 `078` 承担。后续工单改 seed 时必须继续用旧名，直到 seed 与 baseline 重新对齐。
5. 迁移语句顺序固定：索引改名在前，14 张表一条多表 `RENAME TABLE` 在后，与 `054_bw_prefix_rename.sql` 同一规矩。

## 后果

- 破坏性发布：DDL 执行后旧镜像、旧 worker jar 立即读不到表。数据库、后端镜像、worker jar 必须同批上线。
- `RENAME INDEX` 没有 `IF EXISTS`，执行前须在目标库 `SHOW INDEX` 核对 8 条索引名；失败时按「补完剩余索引改名 → 执行多表 RENAME」恢复，不要重跑整个文件。
- ADR-0117 §2 的前缀空间以及 §4/§5/§6 的免改名单对这批表不再适用。具体被取代的条目：§4 的 `generation_model_capability`、§5 的 `template_card` / `template_card_image` / `template_tag`、§3 无名表清单里的 `homepage_hero`、§6 的三个 skill / 三个 asset。其余条款（复数、`uk_{表}__{列}`、审计列、不设 `@@map`）继续有效。
- 同批次的 `project_` 改名见 ADR-0134；两票不重叠。

## 修订（2026-10-29，IKRGTJ / IKRIFX）

- IKRGTJ `086`：`user_shared_asset_snapshots` 整表退役，后端 `shared-assets` 模块、路由与契约，前端共享资产弹窗与保存入口一并删除；`catalog_material_groups` 曾临时改名为 `user_material_info`。
- IKRIFX `088` 修正素材域口径：`user_material_info` → `user_material_groups`（按 `user_id` 存用户人像库分组，归属是用户）；`catalog_material_states` → `user_material_info`（镜像上游素材状态）。三条含旧表名的索引随表改名为 `uk_user_material_info__material`、`idx_user_material_info__poll`、`idx_user_material_info__group`；`user_material_groups` 的三条索引不含旧表名，按决策 3 不改。
- 破坏性窗口：新镜像先上线、迁移尚未执行时，它会按新表名访问仍是旧表名的库，素材组与素材状态相关接口会直接 500；迁移执行后旧镜像立即读不到表。镜像发布与 `086` / `088` 必须在同一维护窗口内完成，先镜像后 DDL，且新镜像不得长时间空跑；迁移必须按 `078` → `086` → `088` 顺序执行，`088` 依赖 `086` 产出的 `user_material_info`。worker-java 的 `MaterialAssetMapper` 读 `user_material_info`，必须与 backend 同批。
- 回滚：先按 `088` 逆序，必须让状态表先让出 `user_material_info`：
  `RENAME TABLE user_material_info TO catalog_material_states, user_material_groups TO user_material_info;`
  再把三条索引改回 `uk_catalog_material_states__material`、`idx_catalog_material_states__poll`、`idx_catalog_material_states__group`；然后按 `086` 逆序 `RENAME TABLE user_material_info TO catalog_material_groups`；并按 `008` + `078` 重建 `user_shared_asset_snapshots`。删表不可恢复，迁移前备份。
- IKRJ9P `089`：`catalog_media_tools` → `bw_media_tools`，索引 `uk_catalog_media_tools__tool_type` → `uk_bw_media_tools__tool_type`；`agent_runs` 整表退役（历史表，无写入方）。
