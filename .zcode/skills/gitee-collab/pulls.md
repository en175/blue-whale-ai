# 代码协作(PR 与发布)

操作对象:仓库。仓库 ID 与默认分支查 registry.md 业务线表。

## 前置:确定仓库与分支

1. 从用户表述(仓库名/业务线)确定目标仓库;不确定 → 回问。
2. target_branch = 该仓库默认分支(registry):sweet-agent-coding → dev;blue-whale-agent → main;其余 → master。

## 创建 PR

`create_enterprise_repo_pull` 必填:enterprise_id、project_id(仓库 ID)、source_branch、target_branch、title。

- title 带关联 issue ident(团队习惯,如 "feat: ... 关联 IK7GAF")。
- body 简述改动与验收关联。

完成标准:创建成功,回报 PR 链接。

## 查看与评论

- 列表:`list_enterprise_pulls`(project_id = 仓库 ID;state=opened 为默认)
- 详情 / 评论:`get_enterprise_pull_detail` / `list_enterprise_pull_comments`
- diff:`get_enterprise_pull_diff`(直接返回 diff 文本)
- 评论:`comment_enterprise_pull`

## 合并(闸门)

合并是最后一步,只做用户明确下令的那一次:`merge_enterprise_pull`(pull_request_id 为 PR 的 IID,merge_method 按用户指定)。

默认行为:查看 can_be_merged 状态并如实报告;不自动合并。

## 发布 release

`create_enterprise_repo_release` 必填:enterprise_id、project_id、release_tag_version、release_title、release_description;release_ref 为分支或 tag。

完成标准:创建成功,回报 release 链接。
