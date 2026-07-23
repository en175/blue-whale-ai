# 测试矩阵（Scenario ↔ 测试名，1:1 核对）

> spec-loop Step 4。每条 spec Scenario 至少对应一条测试；每条测试可追溯到 Scenario。
> 分组：Unit（纯函数）/ Integration（store）/ Component（rf-adapter）。

## Unit — canvas-doc-model（model.ts）

| Scenario | 测试名 |
|---|---|
| 新建空 doc | `it("creates empty doc { nodes:[], edges:[], version:1 }")` |
| 图片节点只存 assetId | `it("image node stores assetId without url/src/imageUrl")` |
| 序列化剥离临时态 | `it("serialize omits status/progress/selected")` |
| round-trip 深相等 | `it("parse(serialize(doc)) deep-equals doc")` |

## Unit — node-kind-registry（kinds.ts）

| Scenario | 测试名 |
|---|---|
| 五 kind 完整 | `it("nodeKinds has text/image/video/audio/group with full spec")` |
| group throw | `it("group.buildTask throws referencing runGroup")` |
| 引用优先 | `it("buildTask uses referenced input over node.data.prompt")` |
| fallback 自带 | `it("buildTask falls back to node.data.prompt when no reference")` |

## Unit — run-engine（engine.ts）

| Scenario | 测试名 |
|---|---|
| resolveInputs 不级联 | `it("resolveInputs reads upstream asset without side effects")` |
| topoSort 有环 null | `it("topoSort returns null on cycle")` |
| topoSort 无环序 | `it("topoSort returns order with upstream before downstream")` |
| runNode 单跑 | `it("runNode calls generate exactly once, no upstream cascade")` |
| runGroup 级联 | `it("runGroup runs members topologically with cascade")` |

## Integration — canvas-store（store.ts）

| Scenario | 测试名 |
|---|---|
| addNode 只动 doc | `it("addNode appends to doc.nodes, leaves assets/selectedIds")` |
| 缓存命中 | `it("render uses assets[id] on cache hit without getAsset")` |
| 缓存 miss | `it("cache miss triggers getAsset and fills assets")` |
| scheduleSave 防抖只存 doc | `it("scheduleSave debounces 800ms and persists only {nodes,edges}")` |
| 切项目隔离 | `it("load replaces doc+assets isolating previous project")` |

## Component — canvas-rf-adapter（CanvasNodes + 节点）

| Scenario | 测试名 |
|---|---|
| nodeTypes 来自 registry | `it("nodeTypes mapped from nodeKinds[kind].Component")` |
| onNodesChange 接 store | `it("onNodesChange updates store.doc.nodes and triggers save")` |
| edges 空 | `it("renders ReactFlow with edges=[] (workflow UI closed)")` |

## 核对

- specs 共 18 Requirement / 21 Scenario；测试矩阵 21 条测试名，**1:1**，无漏无多。
- 纯函数（model/kinds/engine）13 条 Unit 测试，不依赖 React/RF。
- store 5 条 Integration，可用 mock getAsset/持久化层测。
- rf-adapter 3 条 Component，可借现有 CanvasNodes.test.tsx 风格。
