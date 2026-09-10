# IKETSV 素材方案应用：实现与验证记录

## 时间

2026-09-10

## 目标与状态

承接 IKE5G8 的第一纵向切片：手动应用可信 Agent 方案，保留原文和显式素材标签，复用已有素材卡并原子补入缺席素材卡。尚未完成工单验收：音频 Agent 上游范围待确认，仓库选择器存在失败；没有推送、PR、合并或部署。

## 已实现

- 应用 IMAGE / VIDEO 方案；视频组序号不取点击顺序，时间仅取明确区间。
- 标签保存真实资产身份及固定编号；相邻文字编辑、同节点剪切、保存刷新后粘贴排序不丢失绑定。剪贴板不是授权来源，服务端仍对照不可变来源快照校验身份与编号。
- 已有资产精确复用，缺席资产卡与方案及项目资产关联同事务落盘；无生成目标、任务或草稿覆盖。
- 失效素材拒绝整次应用，重复应用也核查当前仍需素材；失败保留画布；并发、删除重建与新预览边界沿用来源三元组。
- 普通节点不能伪造方案来源或素材身份；版本冲突保留已保存内容。

## 自动化证据

| 边界 | 命令与结果 |
| --- | --- |
| 真实浏览器→NestJS公开API→隔离MySQL | `IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsv IKDLQE_BROWSER=1 pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts`，12项通过 |
| 独立Agent领域、authoring工具、真实HTTP处理器→隔离MySQL | 在配套Agent的 `apps/blue-whale-agent` 运行 `AGENT_TEST_DATABASE_URL=mysql://root@127.0.0.1:23416/agent_iketsv pnpm exec vitest run src/domain/prompt-card-revision.test.ts src/mastra/prompt-card-workflow.test.ts src/http/prompt-card-revisions-read.integration.test.ts`，40项通过 |
| 类型与静态检查 | 主仓共享包、backend、web 类型检查通过；web lint通过（保留已有警告）；Agent app类型检查通过 |
| 仓库完成门禁 | `node scripts/verify-change-scope.mjs run` 选择scoped；Web视频参考测试失败，不得作为VERIFIED或发布依据 |

主流程外部 Agent 是记录式替身；浏览器素材缩略图从本地媒体fixture加载。Agent HTTP测试以合法修订fixture验证当前和历史读取保留协议，不代表真实模型已生成这些字段，也不代表两个已部署服务联调通过。浏览器测试使用已认证身份装配，不覆盖登录系统。其它未启用环境变量的旧数据库集成测试仍跳过，不能计入本票已通过数量。

## 独立审查

Standards：未发现硬规则违反或必须修改的代码异味。Spec：发现重复应用漏校验和音频上游缺口；前者新增失败回归后修复并复审闭合，后者仍待范围确认。剪切唯一标签、保存刷新再粘贴的恢复边界也已补测。

## 配套与剩余边界

Agent配套分支 `codex/iketsv-prompt-bindings`，提交 `afd6fc15`，工作区 `../agent-iketsv`。新增 `prompt_mentions` / `time_range`、可信素材映射校验及公开JSON Schema。该app是独立私有应用，未修改发布的框架包。

现有 Agent 的 `domain/asset.ts` 授权入口和素材理解链路仍只接收图片/视频。消费端及预览协议接受audio并通过素材应用测试，不能据此宣称真实音频输入纵向交付。是否在本票扩展音频输入与理解，已向用户提交范围问题。

真实Agent authoring→Canvas的集成环境验证、人工UI验收与部署均未完成。后续Dock引用、目标同步、生成接纳属于后续切片，不在本次实现中。
