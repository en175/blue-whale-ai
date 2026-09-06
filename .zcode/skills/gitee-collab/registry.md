# 业务线 registry

事实源:面板/仓库/类型/状态/标签的 ID 与默认分支。每次操作前先读本表。

## 术语(名称陷阱)

- **project_id = 仓库 ID;program_id = 项目(面板)ID。** 与直觉相反:`list_enterprise_issues` 的 project_id 参数含义是"关联仓库",面板过滤用 program_id。
- 面板 = Gitee"项目":PM 看板(kanban 型)与工程面板(standard 型)在 MCP 里都是 program。
- issue 的 ident(如 IK7GAF)用于 get/update/comment 的 issue_id 参数;数字 id 用于 parent_id / link_issue_id。

## 业务线表

| 业务线 | 别名 | PM 看板(收集需求/缺陷) | 工程面板(派工单) | 仓库(默认分支) |
|---|---|---|---|---|
| OA | OA-Weitian | 896918 | 881847 sweet-agent | sweet-agent-coding 48829590(dev) |
| Gateway | XF-Gateway-OR、网关 | 896917 | 883843 Blue-Whale-AI | blue-whale-api 49512897(master) |
| xfa-Agent | xfa、XF-Agent | 896916 | 891043 XF-Agent | xf-agent 49347648(master) |
| Blue-Whale | 蓝鲸、Blue-Whale-AI | 896915 | 883843 Blue-Whale-AI | blue-whale-ai 48854568(master);blue-whale-agent 49645059(main);blue-whale-pay 49512899(master) |
| Weitian 公共反馈池 | Weitian-OR | 896904(仅收集) | — | 无 |

## 全局共用 ID(所有面板一致)

- issue 类型(issue_type_id):需求 1292681 / 任务 1292680 / 缺陷 1292682
- 状态(issue_state_id,按类型不同):
  - 需求:意向 4336301 / 进行中 4336298 / 已完成 4336299 / 已拒绝 4336302
  - 任务:待办的 4336297 / 进行中 4336298 / 已完成 4336299 / 已取消 4336300
  - 缺陷:待确认 4336303 / 已确认 4336304 / 修复中 4336305 / 已修复 4336306 / 已验收 4336307 / 已拒绝 4336302
- 高频标签(label_ids):ready-for-agent 342812299、needs-triage 342812297、needs-info 342812298、ready-for-human 342812300、PRD 343269706、high-risk 345734871、bug 342775794、feature 342775796、enhancement 342775795、frontend 344594874;完整清单用 `list_enterprise_labels` 查
- 看板列(kanban_column_id):无 MCP 查询工具,不收录;创建看板工单时不传列参数,由面板默认列承接
