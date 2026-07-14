# ADR-0011：统一 project model——以 project 为唯一根对标 topview workspace

- **状态**：Accepted
- **日期**：2026-07-10
- **决策者**：JJNNReno

## 背景

对标竞品 topview.ai。topview 是「workspace/项目」模型（用户→多项目→素材/场景/成片），canvas 本身即 asset 容器；而即梦是「工具生成」模型（灵感/生成/资产/画布并列，资产为用户级全局库）。两者信息架构不同，不能混抄。

仓库内两个**未落地**的 openspec change 各自为政，project 语义不一致：

- `canvas-reactflow-and-persistence`（对标 topview）：设计 `project(id, owner_id, name, thumb, ...)` + `canvas(id, project_id UNIQUE, nodes_json, viewport_json)`，project : canvas = 1:1。**不碰 asset**。
- `add-generate-assets-pages`（对标即梦）：`assets` 用户级全局（无 project_id）；`generation_jobs` 有 `projectId` 但孤悬；`GET /api/agent/assets` / `GET /api/agent/jobs` 按 `userId` 平铺。

真实 schema 断点（实测后端 entity）：

- `GenerationJob`（`generation_jobs`）：有 `projectId`、`outputAssetIds`（`List<Long>`）。
- `Asset`（`assets`）：**无 project_id**。
- 后果：job 挂项目，但 job 产出的 asset 落用户全局。同一项目的生成结果在资产库跨项目混杂。「用户→项目→素材」链断在 asset 这头。

topview 实际模型（web 查证）：生成结果落在它被创建的 canvas 上成 asset card，idea / storyboard / asset / reference 在 canvas 上 "stay connected"；scene 通过 `@` 提及引用 asset card（首尾帧、风格一致）；项目级 asset 为主，团队级共享库 + Brand Kit（Team 付费功能）跨项目复用。本仓 `connect-canvas-image-backend` 已是「生成 → {asset_id, url} → canvas 节点」，与 topview 同构，只差 asset 未归 project、node↔asset 引用未做实。

## 决策

### D1. project 是唯一根

`canvas-reactflow-and-persistence` 的 `project` 表（`owner_id` 归属用户）为唯一真相。canvas / asset / job 全部挂同一棵 project 树。两个 change 焊到一棵树，不再各自为政。

```
user ──< project (owner_id)
          ├── canvas (1:1) → nodes_json[] → node.data.assetId → asset
          ├── asset[] (project_id)
          └── job[] (project_id) → outputAssetIds[] → asset[]
```

### D2. asset 挂 project

`assets` 表加 `project_id NOT NULL`。对齐 topview「生成结果落所属 canvas / project」。MVP 数据少，迁移时回填到默认 project 或清空。

### D3. canvas 节点引用 asset by assetId，不存死 url

canvas 节点（`nodes_json`）存位置 / 尺寸 / z 序 + `data.assetId`；asset 存 url / 宽高 / duration。生成流：job（属 project）→ 产 asset（属 project）→ 落 canvas 节点（引用 asset）。换源 / 重生成改 asset，不动节点。

### D4. project : canvas = 1:1

保留 `canvas-reactflow-and-persistence` 设计。MVP 一个 project 一个画布。多画布 / 多 tab 延后（该 change Open Question 已记）。

### D5. 列表接口改 project 主过滤

`GET /api/agent/assets` / `GET /api/agent/jobs` 以 `projectId` 为主维度；`userId` 退化为归属校验（越权返无权限 `code`），不再是平铺维度。前端 `/assets` / `/generate` 按当前 project 展示。全局「当前 project」context 取代 `X-User-Id` 直传 + localStorage 孤岛。

### D6. 用户级 / 团队级共享库为 Non-Goal

MVP asset 必属 project。topview 的 Team library / Brand Kit（跨项目复用）延后；真要做时另开 `shared_assets` 表或 user 级伪 project，不污染 project 模型。

## 后果

- **正面**：「用户→项目→素材」链贯通，对标 topview workspace。两个 change 共用 project 根，消除落地后返工。
- **正面**：node↔asset 解耦，换源 / 重生成不动节点。
- **代价**：`assets` 表迁移 + 现有列表接口改维度；前端 `ProjectMenu` 从 localStorage 迁后端，全局加「当前 project」context。
- **代价**：asset 必属 project，用户上传的参考素材（如 044 的本地媒体上传）也须归当前 project。

## 迁移策略

1. 后端：`project` + `canvas` 表 + CRUD 先行（`canvas-reactflow-and-persistence` tasks 1.x）。
2. `assets` 表 `ALTER ADD project_id`（NOT NULL）；MVP 存量数据回填默认 project 或清空。
3. `GET /api/agent/assets` / `GET /api/agent/jobs` 改 project 主过滤 + 归属校验。
4. 前端：`ProjectMenu` 接后端；全局「当前 project」context；`/assets` / `/generate` 按当前 project。
5. react flow 迁移 + `ImageNode` 引用 asset。

> 以上为 schema 与接口契约，不含数据发布；涉及真实数据迁移的步骤执行前单独确认。

## 参考

- [`openspec/changes/canvas-reactflow-and-persistence/`](../../openspec/changes/canvas-reactflow-and-persistence/)（对标 topview，project : canvas = 1:1，未落地）
- [`openspec/changes/add-generate-assets-pages/`](../../openspec/changes/add-generate-assets-pages/)（对标即梦，assets 全局，未落地）
- [`openspec/changes/connect-canvas-image-backend/`](../../openspec/changes/connect-canvas-image-backend/)（生成 → asset → 节点，已与 topview 同构）
- topview Canvas：https://www.topview.ai/canvas
- Topview 4.0：https://www.webwire.com/ViewPressRel.asp?aId=350329
