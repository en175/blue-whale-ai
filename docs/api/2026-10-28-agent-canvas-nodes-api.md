# Agent 只读画布节点接口（IKQY39）

## 鉴权与上下文

两个接口都只对 Agent 服务开放，路径在 `internal/` 下，不走用户登录态：

```
Authorization: Bearer <AGENT_SERVICE_TOKEN>
x-blue-whale-tenant-id: <tenant>
x-blue-whale-user-id:   <用户数字 id>
x-blue-whale-project-id: <项目数字 id>
x-blue-whale-session-id: <Agent 会话 id，必填，≤128>
```

- 缺少任一上下文头 → `400 invalid_context`；服务凭证不对 → `401 unauthorized`。
- 服务端校验「该用户拥有该项目」，不满足 → `403 project_forbidden`。
- 会话归属由 Agent 服务在调用前解析；BFF 的信任锚是 `AGENT_SERVICE_TOKEN`，不接受终端用户自报项目。

## 搜索节点

```
POST /api/internal/agent-canvas/nodes/search
{ "name": "蓝鲸", "tags": ["脚本"], "type": "textNode", "node_id": "n1", "parent_node_id": "g1", "cursor": "0", "limit": 50 }
```

- 至少一个筛选项，否则 `400 filter_required`。
- `name`：节点名称（`data.title` 或 `data.name`）子串，忽略大小写。
- `tags`：全部命中才算匹配；标签读自 `data.tags`。
- `type` / `node_id`：精确匹配。
- `parent_node_id`：读自 `data.parentNodeId` 或 `data.parent_node_id`，精确匹配。
- `cursor`：上一页返回的 `next_cursor`（非负整数），默认 0；`limit` 默认 50、最大 200。

返回：

```json
{
  "items": [
    { "id": "n1", "type": "textNode", "name": "蓝鲸文案", "tags": ["脚本"],
      "parent_node_id": "g1", "position": { "x": 1, "y": 2 }, "data": { } }
  ],
  "next_cursor": "1",
  "total": 2
}
```

## 节点详情

```
POST /api/internal/agent-canvas/nodes/details
{ "node_ids": ["n1", "n2"] }
```

- `node_ids` 1–200 个，去重后按请求顺序返回。
- 返回完整节点与**任一端点命中**的边；查不到的 id 放进 `missing`，不用其他对象替代。

```json
{
  "nodes": [ { "id": "n1", "type": "textNode", "name": "蓝鲸文案", "tags": [], "parent_node_id": null, "position": { "x": 1, "y": 2 }, "data": { } } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "data": { "refRole": "reference" } } ],
  "missing": ["n404"]
}
```

## 读写语义

- 只读：不写库、不迁移、不新建任务、不改变归属、不扣费。
- 返回「已保存的最新内容」：行表权威项目读 `project_nodes`/`project_edges`；未迁移项目读旧 JSON（不在读路径触发迁移）。
- 已删除节点与连线不出现在搜索结果、详情节点或 `missing` 之外的任何位置。
- 错误码：`400 invalid_context` / `400 invalid_request` / `400 filter_required` / `401 unauthorized` / `403 project_forbidden`。
