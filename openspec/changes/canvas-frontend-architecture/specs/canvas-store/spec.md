## ADDED Requirements

### Requirement: store 分离持久态与会话态

store SHALL 持有 `doc: { nodes, edges, version }`（持久）与 `assets: Record<id, Asset>`（按需缓存）与 `selectedIds`（会话态）。会话态字段 MUST NOT 写入 doc。

#### Scenario: addNode 只动 doc.nodes

- **WHEN** 调用 `addNode("image")`
- **THEN** `doc.nodes` 长度 +1，`assets` 与 `selectedIds` 不变

### Requirement: assetId 渲染解析与按需缓存

节点渲染 SHALL 按 `data.assetId` 查 `assets`；缓存命中时直接用，缓存 miss 时 SHALL 触发 `getAsset(id)` 拉取并写入 `assets`。

#### Scenario: 缓存命中直接用

- **WHEN** 渲染 `assetId="a1"` 的节点且 `assets["a1"]` 已存在
- **THEN** 使用 `assets["a1"].src`，不调用 `getAsset`

#### Scenario: 缓存 miss 触发拉取

- **WHEN** 渲染 `assetId="a2"` 的节点但 `assets["a2"]` 不存在
- **THEN** 触发 `getAsset("a2")`，成功后 `assets["a2"]` 被填充

### Requirement: scheduleSave 防抖且只存 doc

`scheduleSave` SHALL 防抖（800ms 窗口内多次触发合并为一次），序列化 payload SHALL 只含 `doc`（`{nodes,edges}`），MUST NOT 含 `assets`/`selectedIds`/`status`。

#### Scenario: 高频触发合并为一次

- **WHEN** 800ms 内连续 10 次 `scheduleSave`
- **THEN** 只发起一次持久化 PUT，payload 为 `{nodes,edges}`（无会话态）

### Requirement: 项目隔离

加载新项目 SHALL 整体替换 `doc` 与 `assets`，前一项目的节点与资产 MUST NOT 残留。

#### Scenario: 切换项目隔离数据

- **WHEN** `load(projectB)`（projectA 已加载）
- **THEN** store 的 doc/assets 反映 projectB，projectA 的 node/asset 不可见
