# IKETSV 素材方案应用：实现与验证记录

## 时间

2026-09-11

## 目标与状态

承接 IKE5G8 的第一纵向切片：手动应用可信 Agent 方案，保留原文和显式素材标签，复用已有素材卡并原子补入缺席素材卡。本地实现及测试修复已合入 release/2026.09.15。用户于 2026-09-11 决定先提交开发批次，真实 Agent 联调和人工验收留到测试环境；这不代表验收已通过。音频输入理解已拆至同父项子任务 IKEUUY。

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
| 仓库完成门禁 | 先前失败已修复；本地集成提交 94fe1a6a 的 PR 阶段 full 门禁 VERIFIED，Web 全量 724 项通过。同步最新远端后以新 HEAD 的发布门禁记录为准 |

主流程外部 Agent 是记录式替身；浏览器素材缩略图从本地媒体fixture加载。Agent HTTP测试以合法修订fixture验证当前和历史读取保留协议，不代表真实模型已生成这些字段，也不代表两个已部署服务联调通过。浏览器测试使用已认证身份装配，不覆盖登录系统。其它未启用环境变量的旧数据库集成测试仍跳过，不能计入本票已通过数量。

## 独立审查

Standards：未发现硬规则违反或必须修改的代码异味。Spec：发现重复应用漏校验和音频上游缺口；前者新增失败回归后修复并复审闭合，后者已按用户确认拆至 IKEUUY。剪切唯一标签、保存刷新再粘贴的恢复边界也已补测。

## 配套与剩余边界

Agent配套分支 `codex/iketsv-prompt-bindings`，提交 `afd6fc15`，工作区 `../agent-iketsv`。新增 `prompt_mentions` / `time_range`、可信素材映射校验及公开JSON Schema。该app是独立私有应用，未修改发布的框架包。

现有 Agent 的 `domain/asset.ts` 授权入口和素材理解链路仍只接收图片/视频。消费端及预览协议接受audio并通过素材应用测试，不能据此宣称真实音频输入纵向交付。音频输入与理解由 IKEUUY 单独交付，不作为本票范围。

真实Agent authoring→Canvas的集成环境验证、人工UI验收与部署均未完成。后续Dock引用、目标同步、生成接纳属于后续切片，不在本次实现中。

## 2026-09-11 真实联调准备与测试环境交接

本地前端、NestJS 后端、真实 Agent 与隔离 MySQL/Redis 已启动；Agent 已加载系统提示词与 31 个技能，两个服务健康检查通过。实际模型网关请求返回 503（缺少 NEW_API_AGENT_BILLING_TOKEN），账户能力接口返回 503（账户服务暂不可用）。本机配置的 New API 上游未监听，未执行到真实方案生成与应用画布验收。

用户决定将这部分验证移至测试环境。部署时需同时包含主仓 IKETSV 实现及上述配套 Agent 提交，并配置可用账户与模型网关。验收顺序：真实 Agent 使用两份真实素材生成方案；当前画布已有 A、缺席 B；应用后复用 A、补入 B；刷新后检查正文、素材身份与编号保留；最后由用户确认 UI 效果。发生问题再回对应任务分支修复。尚未部署、尚未人工验收，不应据此标记已验收。
