# 任务管理(issues)

操作对象:PM 看板(需求/缺陷收集)与工程面板(开发工单)。目标面板 ID 查 registry.md。

## 查询

- 面板任务列表:`list_enterprise_issues`(enterprise_id + program_id;可按 state / label_ids / assignee_id / search 过滤)
- 详情:`get_enterprise_issue_detail`(issue_id 用 ident)
- 评论:`list_enterprise_issue_comments`

完成标准:信息已取回并向用户呈现。

## 创建

`create_enterprise_issue` 必填:enterprise_id、title。

| 参数 | 填写 |
|---|---|
| program_id | 目标面板 ID(registry 业务线表) |
| issue_type_id | 需求/任务/缺陷(registry) |
| priority | 0 未指定 / 1 轻微 / 2 次要 / 3 主要 / 4 严重 |
| label_ids | 逗号分隔,按用户指令或沿用源 issue |
| assignee_id / deadline / description / branch | 按用户指令 |

完成标准:创建成功,回报 ident(如 IK7GAF)与数字 id。

## 更新与评论

- `update_enterprise_issue`:issue_id 用 ident;改状态用 issue_state_id(按 issue 类型查 registry 状态表)。
- `comment_enterprise_issue`:issue_id 用 ident,body 为评论内容。

完成标准:更新后回报变更项。

## 流转:公共池/PM 看板 → 工程面板

1. 读源 issue 详情,提取标题、类型、描述、标签。
2. 向用户复述:"将【标题】从【源面板】流转到【工程面板】",得到确认。
3. `create_enterprise_issue` 在工程面板创建工单:program_id = 工程面板;issue_type_id 沿用源类型;title 保留原义;description 附源 issue 链接;parent_id = 源 issue 数字 id。
4. `comment_enterprise_issue` 在源 issue 留言:"已流转至工程面板,工单:【新 ident】"。

完成标准:双方 issue 已互链(源 issue 的 parent 关系与评论可见),并把两个链接回报用户。
