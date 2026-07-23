## 关键决策速查（详见 ADR-0022）

| 决策 | 结论 | 来源 |
|---|---|---|
| 媒体产物存储 | `assetId` 引用（非 url） | ADR-0022 §决策1 |
| assets 填充 | 按需缓存（`getAsset` + 生成注册），canvas opaque 只存 {nodes,edges} | ADR-0022 §决策2 |
| 状态管理 | Zustand 替换 useReducer | ADR-0022 §决策3 |
| 现有代码 | 渐进迁移（messages/placement/recover 接 store） | ADR-0022 §决策4 |
| 工作流 UI | 底层就绪，UI 不开 | ADR-0022 §决策5 |
| 工作流底层 | edges/engine/group/recipe 全保留 | ADR-0022 §决策6 |
| runEngine | 纯函数 + 留 generate 接口 | ADR-0022 §决策7 |
| NodeKind registry | 含 group 占位 | ADR-0022 §决策8 |
| 后端 | 不动（opaque PUT 继续） | ADR-0022 §决策9 |
| 迁移策略 | strangler 并行（/canvas-v2，老 /canvas 不动） | ADR-0023 |

## 跨 capability 风险与缓解

1. **assetId 契约跨 model/store/rf-adapter**：model 定 `assetId`，store 管 `assets` 缓存，rf-adapter 按 assetId 渲染。**缓解**：L0 model 先冻结类型，store/rf 依赖 model 类型；三者同 PR 落地避免漂移。
2. **Zustand 迁移丢 projectReducer 测试**：reducer 的 add-node/delete-node/项目隔离等 action 逻辑迁 store。**缓解**：store 等价测试先写（红），再迁逻辑（绿），覆盖 reducer 原 action 语义。
3. **`canvas.nodes_json` 结构 BREAKING**（`NodeItem[]`→`{nodes,edges}`）：**缓解**：清表 15 条旧数据，schemaVersion 从干净 v1 起，不写读层降级。
4. **engine 留 generate 接口但 UI 不触发**（建了没用户路径）：**缓解**：纯函数单测覆盖 resolveInputs/topoSort/runNode（RunCtx.generate 用 mock），未来开 UI 零改动接真实生成。
5. **临时态误入持久 doc**（现状 progress:90 落库）：**缓解**：store 严格分离 doc（持久）vs selectedIds/status（会话态），scheduleSave 只序列化 doc。

## 迁移 / 执行顺序

```
L0 model（冻结类型）→ L1 kinds（registry+单测）→ L3 engine（纯函数+单测）
  → L4 store（迁 reducer 逻辑 + 等价测试）→ L2 rf-adapter（接 store + 节点组件）
  → lib/canvas.ts（opaque 存 {nodes,edges}）→ 保留代码接 store → 清表 → 验收
```

L0-L3 是纯函数，可并行先做（无 RF/store 依赖）；L4 依赖 L0；L2 依赖 L1/L4；持久化与迁移在 L2 之后。
