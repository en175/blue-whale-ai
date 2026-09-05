---
name: gitee-collab
description: 团队 Gitee 企业版协同:创建/查询/更新任务、需求、缺陷、工单;需求流转/派发到工程面板;创建/查看 PR(合并请求)与发布 release;查询企业项目、仓库、成员;Gitee MCP 工具缺失时安装部署 MCP Server。业务线:OA、Gateway、xfa-Agent、Blue-Whale、Weitian。
---

# Gitee 协同

所有操作经 MCP 工具 `mcp__gitee-ent__*` 完成,enterprise_id = 16660949。

## 第零步:确认 Gitee MCP Server 已接通

1. `mcp__gitee-ent__*` 工具存在 → 进入第一步。
2. 工具缺失或调用失败 → 按 [mcp-setup.md](mcp-setup.md) 安装部署 MCP Server,接通后再继续。

## 第一步:识别目标(任何操作前)

1. 读 [registry.md](registry.md) 业务线表,确定目标面板/仓库的 ID 与默认分支。
2. 用户未指明目标,或一个名称命中多个条目 → 回问用户确认后再操作。
3. 写操作(创建/更新/流转)执行前向用户复述目标;执行后回报 issue ident 或 PR 链接。

## 路由

- 任务/需求/缺陷/工单、跨面板流转 → [issues.md](issues.md)
- PR、代码评论、发布 release → [pulls.md](pulls.md)
- 只读查询(项目/仓库/成员/标签/文件树)→ 直接调 `mcp__gitee-ent__list_*` / `get_*`,ID 从 registry.md 取

## 全局纪律

- 权限错误(403 等)如实转述用户:该操作需要 Gitee 侧对应权限;不重试、不绕行。
- registry.md 没有的 ID 用 list_* 工具实时查;查不到就回问,不虚构。
