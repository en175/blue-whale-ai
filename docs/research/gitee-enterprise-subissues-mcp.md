# Gitee Enterprise Sub-Issues MCP Notes

## 结论

Gitee 帮助中心说明，工作项详情页提供“子工作项”tab，可以在页面中查看和管理子工作项。

但官方 MCP 文档列出的 Issue 工具主要是 `get`、`list`、`comment`、`create`、`update` 等操作，没有看到“按父工作项列出子工作项”的专用工具。

## mcp-gitee-ent 源码观察

- `list_issues.go` 支持 `filter_child`，但没有 `parent_id` 入参，因此不能直接表达“列出某个父项下的子项”。
- `get_issue_detail.go` 的 `IssueDetail` 结构没有 `children` 字段，因此详情接口返回结构中没有直接暴露子工作项列表。
- `create` / `update` 支持 `parent_id`，说明该 MCP 可以创建或更新父子关系，但目前没有对应的按父项查询子项工具。

## 影响

如果需要通过 MCP 自动枚举某个工作项的子工作项，现有工具面不足；可行方向是补充一个按 `parent_id` 查询或解析详情页子工作项数据的工具。
