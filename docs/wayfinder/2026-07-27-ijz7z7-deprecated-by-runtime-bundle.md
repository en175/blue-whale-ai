# IJZ7Z7 体系被声明式 Runtime Agent Bundle 取代：核查与关票执行

> 日期：2026-07-27
> 基准：`origin/master` @ `b2f6bf2`
> 相关 issue：#IK29RN（前端接后端三链路总图）、#IJZ7Z7（Agent 对话链路）、#IK2D7Z（声明式 Runtime Agent Bundle）、#IK2D8R（首版 Bundle 迁移）

## 摘要

原「前端接后端三链路总图」（#IK29RN）把 Agent 对话 / Dock 直生 / Skill 面板当三条并行待建链路。核查 `origin/master` 后确认：**Agent 对话 + Skill 面板已通过 KimJohn 的声明式 Runtime Agent Bundle 路线（#IK2D7Z）闭环**，IJZ7Z7 的 L1 classifier + 九分支 + `/agent/turn` 方案被完全取代。原总图实质只剩 **Dock 直生一条**真未做。

本次据此关闭 9 张 wontfix 票 + 1 张已完成票，收窄 3 张留 open 票。仅改动 333333 创建的 issue，KimJohn 的 #IK2D7Z / #IK2D8R / IK3NP* 全部未动。

## 背景：两条互相否定的方案

| 维度 | IJZ7Z7（333333）| IK2D7Z（KimJohn）|
|---|---|---|
| 决策面 | Java：L1 classifier + `decision_branch` 九分支 switch | Skill / Python Worker 自主决策，Java 只铁闸 |
| 传输 | `POST /agent/turn` SSE + 7 事件 | Conversation 命令 + Project SSE 分块重放（不恢复 `/agent/turn`）|
| Java 角色 | 主编排 | 控制面 + 不可协商铁闸 |
| 编排位置 | Java 主 Agent switch | Python Worker（pydantic-ai）|

代码侧胜负已定：声明式 Bundle 全链路落地，IJZ7Z7 那套 `.java` 残留为 0。

## 代码侧核查（声明式 Bundle 已闭环）

| 子系统 | 状态 | 关键证据 |
|---|---|---|
| Bundle 维护源 | ✅ | `blue-whale-agent-workspace/runtime-bundle/`（README / build.py / bundle-source.json + 7 资源）|
| Java 控制面 | ✅ | `RuntimeBundleController`（`/internal/runtime-bundles`：publish / activate / rollback / import / export / validate）+ V10 / V17 / V18 迁移 + 写幂等 + 静态校验 |
| Python Worker | ✅ | `blue_whale_agent_worker/`（pydantic-ai 2.9.0）：Bundle 解析 + Run pin 双重校验 + 三层渐进装载 + Skill 驱动通用多轮 Orchestrator + checkpoint 从消息历史重建 |
| SSE 分块协议 | ✅ | `ProjectController /{id}/events` + `assistant_message_streams / chunks` + Java 权威合并 + 审核释放前缀；前端 `project-recovery.ts:168` 单调版本覆盖重放 |
| 四类媒体闭环 | ✅ | `create_image / video_generation_job` 工具 + OpenAi / VolcEngine / Seedance Provider（文生 / 引用图再创 / 文生视频 / 引用图生视频）+ GenerationJob 解耦 |
| Skill forced 端到端 | ✅ | 点 Use → `pendingForcedSkill` → Run pin `activated_creative_skill_versions` → `RuntimeBundleRunPinResolver`（IK3NPC / F）|
| Skill 推荐 | ✅ | `SkillRecommendationSection.tsx`（IK3NPI）|

落地 commit（全部 `is-ancestor origin/master`）：`5d349ffc`（IK2D8R）、`edd90ecf`（IK3NPB）、`b42a6716`（IK3NPC）、`21328a4c`（IK3NPD）、`920db375`（IK3NPF）、`9d9182a3`（IK3NPI）。

## 三链路真实完成度

| 链路 | 真实状态 | issue 动作 |
|---|---|---|
| Agent 对话（IJZ7Z7）| ✅ 已被 #IK2D7Z 声明式 Bundle 取代闭环 | wontfix |
| Skill 面板（IJZ7Z8）| ✅ 全通（验收 7 经 Bundle forced 达成）| 已完成 |
| Dock 直生（IJZ7Z9）| ⚠️ 唯一真缺口（catalog / presign / 上传）| 留 open，收窄 |
| G0（IK2H6I）| ⚠️ understanding 字段待确认；presign 归 Dock | 留 open |

## Dock 直生真缺口（origin/master b2f6bf2）

1. catalog 聚合接口后端零（仅 `GenerationController` 单维 `?capability=image`）
2. presign 直传后端零（`AssetController` 仅 GET）
3. 上传实际是本地 blob 预览（`canvas/page.tsx handleDockLocalUpload` 仅 `createObjectURL`），未接后端
4. 前端 `getCatalog` / `presignAsset` / `completeAsset` / `getAsset` 四函数确认死代码

`AGENT_MODELS` 两处硬编码（`AgentComposer.tsx` + `AgentChatPanel.tsx`）保留——声明式 Bundle 已废 agent 主模型 catalog 化需求。

## 文档侧残留（IK2D8R 清理未做完）

**已加废弃横幅（6 处）**：`PRD/AGENT-CONVERSATION-PRD.md`、`PRD/BACKEND-API-PRD.md`、`PRD/FRONTEND-INTEGRATION-ROADMAP.md`、`skill/SKILL.md`、`blue-whale-agent-workspace/CLAUDE.md`、`skill/references/backend_implementation_contract.md`

**无横幅仍当活权威（9 处，真残留）**：
- `skill/rules/decision_layer.md`（九分支权威源，259 行）
- `skill/workers/director_agent.md`（主 Agent switch 权威）
- `skill/rules/generation_route_decision.md`
- `skill/rules/confirmation_gate.md`
- `skill/rules/revise_canvas.md`
- `skill/workflows/video_agent_canvas.md`
- `skill/workflows/direct_generation.md`
- `skill/workflows/image_generation_prompt.md`
- `tests/scenarios/acceptance_criteria.md`

IK2D8R 验收「文档中不存在两个并行公开对话传输协议」**顶层达成、`skill/` 子层未达成**。

## 执行动作（2026-07-27，仅 333333 创建的 issue）

### wontfix（9 张，rejected + wontfix 标签）

| ident | 标题 | 评论 id |
|---|---|---|
| IJZ7Z7 | Agent 对话链路：SSE + 三链路 runtime | 50645137 |
| IK2H7R | B：turn 骨架 + decision_context + SSE wire + message 表 | 50645246 |
| IK2IJP | C：轻量编排 + Direct 生成 | 50645251 |
| IK2IJR | D：图生视频 + asset_understanding + 候选图消歧 | 50645254 |
| IK2IJT | E：确认门四分类 + advance_stage 铁闸 | 50645256 |
| IK2IJU | F：Full Canvas 跨 turn | 50645261 |
| IK2IJV | G：刷新不丢 + active_jobs 接力 | 50645267 |
| IK2IJW | H：不泄露内部信息校验 | 50645275 |

### 已完成（1 张，closed）

| ident | 标题 | 评论 id |
|---|---|---|
| IJZ7Z8 | Skill 面板：library / mine / 封面 | 50645198 |

### 留 open + 评论（3 张）

| ident | 标题 | 评论 id | 要点 |
|---|---|---|---|
| IJZ7Z9 | Dock 直生链路 | 50645201 | 收窄到 catalog / presign / 上传 |
| IK2H6I | G0 共享地基 | 50645205 | understanding 待 KimJohn 定；presign 归 Dock |
| IK29RN | 三链路总图 | 50645236 | 三链路重判，只剩 Dock 真待建 |

## 悬空与未做

- **悬空**：G0 `understanding` 字段去留（声明式 Bundle 引用图生视频直接传 `reference_asset_ids` 给 Seedance Provider，不做前置 understanding；字段 + 候选图消歧前置逻辑是否整体废弃，待 #IK2D7Z 作者 KimJohn 确认，挂在 #IK2H6I 评论）
- **未做 1**：`skill/` 子层 9 文件补废弃横幅对齐顶层（需 docs worktree，`skill/` 不属 ADR-0025 散文例外）
- **未做 2**：#IK29RN body 本体仍含过时「三链路并行待建」表述（当前只加评论未改 body）
