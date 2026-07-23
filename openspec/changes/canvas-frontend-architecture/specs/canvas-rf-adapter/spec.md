## ADDED Requirements

### Requirement: nodeTypes 来自 registry

`CanvasNodes` 的 `nodeTypes` SHALL 从 `nodeKinds` 的 `Component` 映射而来，MUST NOT 硬编码组件映射。

#### Scenario: nodeTypes 覆盖所有 kind 且来自 registry

- **WHEN** 读取 CanvasNodes 传入 ReactFlow 的 `nodeTypes`
- **THEN** 每个 kind（text/image/video/audio/group）的组件 === `nodeKinds[kind].Component`

### Requirement: onNodesChange 接 store

RF 的 `onNodesChange` SHALL 把变化应用到 `store.doc.nodes`（经 store action），MUST NOT 在组件内自维护节点数组或全量写回 page reducer。

#### Scenario: 拖拽更新 store 并触发保存

- **WHEN** 拖拽一个节点产生 position change
- **THEN** `store.doc.nodes` 中该节点 position 更新，且 `scheduleSave` 被触发

### Requirement: 本轮不渲染连线

CanvasNodes SHALL 以 `edges={[]}` 渲染 ReactFlow（工作流 UI 本轮不开放），但 doc 仍保留 `edges` 字段供未来。

#### Scenario: 传入 RF 的 edges 为空

- **WHEN** 渲染画布（即使 doc.edges 非空）
- **THEN** 传给 ReactFlow 的 edges prop 为 `[]`，且不渲染任何连线交互
