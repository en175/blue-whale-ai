# IKETSW｜方案引用生图目标的本地验收记录

## 时间

2026-09-11

## 背景与目标

基于用户确认的本地 `release/2026.09.15`，固定基线 `dfb5c533d53d9e569a2de688e0655e41430bcbac`，承接 IKETSV。交付范围为方案拖线／Dock 引用到图片目标、完整素材输入与生成快照；不包含后续视频、同步和移除界面。

关联：[父规格](../IKE5G8/IKE5G8-prompt-card-spec.md)、[本票契约](../../specs/2026-09-11-iketsw-prompt-target-contract.md)。

## 已验证的用户行为

| 场景 | 观察证据 |
| --- | --- |
| 应用后 Dock 引用及拖线引用 | 真实浏览器操作产生相同来源集合；正文附件与媒体分别直接连入目标；已有提示词不变 |
| 撤销／重做、刷新 | 连线可原子撤销／恢复；刷新后附件、参考图和目标提示词恢复 |
| 手动连线与共享素材 | 公开 API 读回 manual 来源与多个 planNodeIds；重复引用不增加同一素材输入 |
| 缺失／删除／不支持模型／版本冲突 | 公开 API 拒绝创建，素材错误包含具体 #7 索引 |
| 断开并恢复素材 | 断开后生成被拒绝；恢复后可仅凭附件提交，使用最新保存的方案文字 |
| 纯文字及历史 HTML 附件 | 纯文字方案可无目标提示词、无图片提交；旧 HTML 正文投影回归通过 |
| 接纳快照与执行 | 公开 jobs API 返回原文／标签／图片 URL／编译正文；接纳后改变资产 URL，TS 执行器仍向记录式供应商发送冻结值并完成任务 |

## 验证入口

使用独立本地 MySQL 数据库 `iketsw`，不连接测试站。真实 Canvas、Project、Generation、Jobs、Usage 业务 API 与 Prisma 持久化均参与；认证中间件注入测试身份，外部 Agent、账户服务和图片供应商使用记录式替身。

```bash
IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsw IKETSW_BROWSER=1 \
  pnpm exec vitest run \
  backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts \
  backend/libs/shared/generation/handle-create-generation-job.test.ts
```

定向结果：93 项通过，1 项既有跳过。Java 在 JDK 21 的 Maven 容器运行现有全套测试，226 项通过、无失败或跳过。Web 与 Backend 类型检查已运行。

最终收口必须按当前干净 HEAD 运行仓库选择器，凭证由工具保存在 Git common dir；本文不替代该凭证：

```bash
IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsw IKETSW_BROWSER=1 \
  node scripts/verify-change-scope.mjs run --base dfb5c533d53d9e569a2de688e0655e41430bcbac --json
node scripts/verify-change-scope.mjs check --base dfb5c533d53d9e569a2de688e0655e41430bcbac --json
```

## 审查与交付边界

Standards、Spec 两个独立子代理审查完成：绑定规范化重复已集中至共享契约；旧 HTML 兼容回归已修复并复核。未留未解决的审查项。

本记录不证明真实供应商效果、真实 Agent 联调、MQ 自动派发、Java 新快照分支的独立端到端执行或人工 `dev:test` 验收。Java 本票变更已编译并通过现有测试，新快照的供应商请求一致性由 TS 执行链路验证。

交付停在本地任务分支提交；未推送、未创建 PR、未合入 release、未部署。下一步为人工审查本地提交及界面行为。
