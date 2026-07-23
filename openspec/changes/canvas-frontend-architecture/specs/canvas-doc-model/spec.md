## ADDED Requirements

### Requirement: CanvasDoc 结构

CanvasDoc SHALL 包含 `nodes: CanvasNode[]`、`edges: CanvasEdge[]`、`version: number`。`edges` 本轮 SHALL 恒为空数组（工作流留位，不渲染连线）。

#### Scenario: 新建空画布

- **WHEN** 构造一个新 CanvasDoc
- **THEN** 其 shape 为 `{ nodes: [], edges: [], version: 1 }`

### Requirement: CanvasNode 媒体引用 assetId

媒体类 CanvasNode（image/video/audio）SHALL 通过 `data.assetId: string` 引用 `Asset` 实体，MUST NOT 在节点内存储 `url`/`src`/`cover`/`duration` 等资源字段。text 节点的 `assetId` SHALL 为空。

#### Scenario: 图片节点只存 assetId

- **WHEN** 创建一个 image 节点并指向 assetId `"a1"`
- **THEN** `node.data.assetId === "a1"` 且 `node.data` 不含 `url`/`src`/`imageUrl` 字段

### Requirement: 临时态不进文档

`CanvasNodeData` 的 `status`/`progress`/`selected` MUST NOT 序列化进 CanvasDoc（属会话态/运行投影态，归 canvas-store 管理）。

#### Scenario: 序列化剥离临时态

- **WHEN** 序列化一个 `data.status === "running"`、`selected === true` 的节点进 CanvasDoc
- **THEN** 序列化输出的 JSON 不含 `status`/`progress`/`selected` 键

### Requirement: 序列化 round-trip 确定

CanvasDoc 经 `serialize → parse` SHALL 与原文档深相等（键顺序与浮点归一化确定）。

#### Scenario: round-trip 深相等

- **WHEN** 对一个含多节点的 CanvasDoc 做 `parse(serialize(doc))`
- **THEN** 结果深等于原 `doc`
