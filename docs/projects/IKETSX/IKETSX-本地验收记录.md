# IKETSX｜方案视频生成与跨类型复用本地验收

## 时间

2026-09-11

## 基线与范围

用户明确允许从本地 release/2026.09.15 的 `1e966847a0f3cada69d71b1c38850087966d4d02` 创建独立任务区，分支 `feature/IKETSX-方案视频生成跨类型复用`。复用 IKETSW 引用命令与快照；包含必要的前端、API、契约、TS/Java 执行器配套。不新增音频生成目标或方案同步 UI。

契约见 [视频方案输入契约](../../specs/2026-09-11-iketsx-video-plan-contract.md)，父规格见 [IKE5G8](../IKE5G8/IKE5G8-prompt-card-spec.md)。

## 已验证行为

| 边界 | 证据 |
| --- | --- |
| 真实浏览器与业务 API | 视频目标 Dock 引用、拖线引用得到相同直接输入；图片/视频/音频三类参考同时展示；保留草稿、原子撤销重做、刷新恢复、提交、结果返回原目标 |
| 跨类型 | IMAGE 用途方案用于视频目标；VIDEO 用途方案用于图片目标；标题不切换目标 |
| 接纳失败 | 缺少被引用素材、声明类型错误、角色不符、视频格式不支持、越权、模型数量超限、模式不兼容均拒绝，失败后无有效任务 |
| 纯文字 | 视频方案无媒体、目标无自由提示词时仍可接纳，冻结正文及空参考列表 |
| TS 执行与供应商 HTTP | 真实持久化领取/写回，实际 HTTP 请求包含编译正文与三类素材；接纳后修改 URL/关联素材 ID，仍发送冻结输入；保留目标已有手动角色库参考 |
| Java 执行与供应商 HTTP | 公开 API 创建任务，Java 真实 MyBatis/事务/领取/执行/终态写入，仅轮询公开 jobs API 验证成功，不调用 TS 补完；HTTP 正文、媒体身份、顺序与快照一致 |

## 复现入口

数据库为独立本地 MySQL `iketsx`（127.0.0.1:23416），不连接测试站。前后端与数据库是真实实现；仅外部 Agent、账户服务、生成供应商、对象存储与队列调度为测试边界替身。测试直接按 jobId 驱动真实执行器，没有模拟 Canvas/Generation/Jobs 业务 API。

```bash
IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsx IKETSX_BROWSER=1 IKETSW_BROWSER=1 \
  pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts \
  backend/libs/shared/generation/handle-create-generation-job.test.ts

IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23416/iketsx IKETSX_JAVA=1 \
  pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts -t 'IKETSX:'
```

Java 集成由上述 API 用例调用 JDK21 Maven 容器，数据库与记录式 HTTP 服务通过 host.docker.internal 访问。执行入口为 `PromptPlanVideoIntegrationTest`；默认没有 IKETSX_JOB_ID 时跳过，外层 API 用例负责核验请求与终态。Java 原有全套 226 项通过；本次新增真实数据库执行用例另行开启通过。

仓库收口凭证通过 `node scripts/verify-change-scope.mjs run/check --base 1e966847a0f3cada69d71b1c38850087966d4d02 --json` 绑定最终干净 HEAD；以实际 check 结果为准，本记录不替代凭证。

## 交付边界

未进行人工 dev:test 验收、真实供应商效果验收、MQ 自动派发或部署。Java 与 TS 供应商 JSON 的媒体身份、顺序和角色一致；Java 现有适配器还在 URL 对象内部重复 role 字段，不影响本次冻结值对账。

任务交付停在本地提交与审查。没有推送、创建 PR、合入 release 或更新父需求。
