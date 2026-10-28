# 画布按节点 apply：版本前置（IKRAEV）

## 接口

```
POST /api/canvases/:projectId/apply
If-Match: "<version>" | "missing"   # 可选
Content-Type: application/json

{ "upsert_nodes": [], "delete_node_ids": [], "upsert_edges": [], "delete_edge_ids": [], "viewport": {...} }
```

`If-Match` 与整份保存 `PUT /api/canvases/:projectId` 完全一致：

| 头 | 期望 | 不匹配时 |
| --- | --- | --- |
| 不带 | 不校验版本（沿用旧行为） | — |
| `"3"` | 画布当前版本必须是 3 | 412，`data.version` 为当前版本 |
| `"missing"` | 画布行必须不存在 | 412 |

版本冲突时不应用任何改动（事务内校验，零写入）。

## 版本推进

- 节点或连线的任意新增、更新、删除（含级联删边）都会把 `project_canvas.version` +1。
- 只改 viewport 时同样 +1。
- 请求内所有对象都无差异（全部 skipped）时不推进版本。
- 项目首次写入会先做旧 JSON 懒迁移，迁移本身推进一次版本，因此首次写入可能 +2。
- 响应 `data.version` 是本次写入后的版本，可直接用于下一次 `If-Match`。

## 与整份保存的关系

`PUT /api/canvases/:projectId` 行为不变；两条写入路径共用同一版本号，混用时以最后一次写入后的版本为准。前端下一期切到按节点提交时，用 `If-Match` 保留「双窗口不静默覆盖」。
