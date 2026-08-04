# IK2D8R 首版 Runtime Bundle 迁移清单

- **工单**：[IK2D8R — 审计并迁移首版 Runtime Bundle，清理旧固定判定契约](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK2D8R)
- **契约权威**：[Runtime Agent Bundle 领域契约与资源规范](../specs/2026-07-20-runtime-agent-bundle-contract.md)（Accepted v1）+ [runtime-agent-bundle.schema.json](../specs/runtime-agent-bundle.schema.json)
- **首版 Bundle 维护源**：`blue-whale-agent-workspace/runtime-bundle/`（构建：`python3 build.py`，本地生成 `dist/` 便携包，gitignore 忽略不入库；测试现场重建）
- **行为评测与隔离装载验证**：`blue_whale_agent_worker/tests/test_first_runtime_bundle.py`；导入静态校验：`FirstRuntimeBundleImportIT`

## 结论定义

| 结论 | 含义 |
|---|---|
| **重写** | 内容经审计改写后进入首版 Bundle 对应资源；原文件保留在历史区，不再是实现权威 |
| **保留** | 内容仍然有效，原样保留；归属 Creative Skill 领域参考，不进入 Runtime Bundle 基础上下文 |
| **归档** | 保留在原处作为历史/审计记录，不再是实现权威；物理归并到 archive 目录留待后续工单 |
| **拆分** | 归属另一领域对象（Creative Skill 库），由后续工单迁移；不进入 Runtime Bundle |

## 首版 Bundle 组成（重写产物）

| Bundle 资源 | 种类 / loadMode | 主要来源 |
|---|---|---|
| `role_director`（AGENTS.md） | RoleDocument / always_on | `workers/director_agent.md` |
| `rule_natural_confirmation` | Rule / always_on（confirmation） | `rules/confirmation_gate.md`（统一弱继续口径，废固定确认门） |
| `rule_progressive_disclosure` | Rule / always_on（disclosure） | `rules/progressive_disclosure.md` |
| `rule_conversation_canvas_facts` | Rule / always_on（facts） | `rules/canvas_state_rules.md` |
| `rule_output_boundary` | Rule / always_on（output） | `references/output_contract.md` + `rules/visible_reasoning.md` |
| `skill_director_workflow` | 根 RuntimeSkill / on_demand | `SKILL.md` + `workflows/direct_generation.md` 的顾问式链路 |
| `ref_generation_action_guide` | Reference / on_demand（根 Skill 确定引用） | `workflows/direct_generation.md` + `workflows/image_generation_prompt.md` + `workers/generation_agent.md` / `image_prompt_agent.md` 的参数整理职责 |

首版 Bundle **不含**任何 CreativeSkill 资源；`library/raw` 全部模板不进基础上下文（见下「拆分」）。

## 逐资源迁移结论

### 根入口（1）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `skill/SKILL.md` | 重写 | → 根 RuntimeSkill `skill_director_workflow`。剔除读 `decision_context`→`switch(decision_branch)` 收口、九分支路由、L1 配合与固定确认门；改为顾问式多轮工作流 |

### workers/（9）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `workers/director_agent.md` | 重写 | → RoleDocument `role_director`。保留身份/职责/协作边界/输出原则；剔除 decision_context 收口、分支动作表、L1 推翻规则、确认门铁闸 |
| `workers/brief_agent.md` | 归档 | 渐进收集 Brief 的方法论由 `rule_progressive_disclosure` 与根 Skill 吸收；不再有「worker 文件即产品角色」约定（契约 §9） |
| `workers/skill_selector.md` | 归档 | Skill 推荐并入根 Skill 推进方式（list_creative_skills + 推荐理由） |
| `workers/storyboard_agent.md` | 归档 | 脚本分镜属 Creative Skill 创作方法论，不进运行时基础上下文 |
| `workers/generation_agent.md` | 重写 | 生成参数整理职责并入 `ref_generation_action_guide`；GenerationJob 生命周期归平台铁闸 |
| `workers/image_prompt_agent.md` | 重写 | 生图 prompt 要素并入 `ref_generation_action_guide` |
| `workers/prompt_optimizer_agent.md` | 归档 | 提示词优化是生成链路内部能力；Agent 只提议产品中性参数，不持有优化器角色 |
| `workers/image_understanding_agent.md` | 归档 | 图片理解是 Asset understanding 产品能力（数据挂 Asset），非运行时角色 |
| `workers/review_agent.md` | 归档 | 审核结论是 Conversation 过程内容，边界由 `rule_conversation_canvas_facts` 吸收 |

### rules/（11）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `rules/progressive_disclosure.md` | 重写 | → `rule_progressive_disclosure`；剔除与固定 stage 流程耦合的分阶段问单表述 |
| `rules/canvas_state_rules.md` | 重写 | → `rule_conversation_canvas_facts`；Canvas 收窄为 Asset 素材视图，废 Stage 对象模型与 turn 级字段约定 |
| `rules/confirmation_gate.md` | 重写 | → `rule_natural_confirmation`；统一弱继续口径（弱继续不构成高成本/不可逆授权），废固定确认门与 ready-node 状态机，铁闸归平台 |
| `rules/visible_reasoning.md` | 重写 | → `rule_output_boundary`（与 output_contract 合并为输出边界） |
| `rules/decision_layer.md` | 归档 | `decision_context` / L1 classifier / 固定九分支整体废弃，不做兼容 DTO（契约 §9） |
| `rules/generation_route_decision.md` | 归档 | Dock 直生 vs Agent 入口划分是产品路由，L1 分流废弃；非模型行为规则 |
| `rules/revise_canvas.md` | 归档 | 局部修改是顾问式对话的自然行为，由根 Skill 吸收；L1 依赖废弃 |
| `rules/product_switch_p0.md` | 归档 | 多产品历史切换是平台产品状态语义，非模型规则 |
| `rules/prompt_optimization_chain.md` | 归档 | 优化链路编排位置属生成链路内部实现 |
| `rules/skill_generation_priority.md` | 归档 | 「Skill 定创意、模型定语法」属 Creative Skill 使用指引 |
| `rules/multimodal_capability.md` | 归档 | 能力判定由 ModelProfile capabilities 与平台铁闸承担 |

### workflows/（4）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `workflows/direct_generation.md` | 重写 | → 根 Skill 推进方式 + `ref_generation_action_guide`；剔除 decision_context 路由判断与固定 stage 表 |
| `workflows/image_generation_prompt.md` | 重写 | → `ref_generation_action_guide` 图片动作参数指引 |
| `workflows/video_agent_canvas.md` | 归档 | 固定 stage 硬停/软过流程废弃；完整广告编排属 Creative Skill 领域 |
| `workflows/image_understanding.md` | 归档 | 图片理解流程是产品能力，非运行时工作流 |

### library/（109）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `library/_index.md` | 拆分 | → Creative Skill 库索引；随模板迁移由后续工单处理（Use/auto 链路不在本工单范围） |
| `library/raw/cn01–cn108`（108 个创作模板） | 拆分 | → Creative Skill 库（用户可见创作方法，`skill` 表迁移路径见契约 §9）。全部不进 Runtime Bundle 基础上下文；首版 Bundle 不含任何 CreativeSkill 资源 |

### references/（8）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `references/output_contract.md` | 重写 | → `rule_output_boundary`；剔除 optimized_prompt_preview 等旧字段约定 |
| `references/seedance_prompt_optimizer.md` | 保留 | Seedance 提示词语法参考仍有效；归 Creative Skill 领域参考，不进 Runtime Bundle |
| `references/backend_implementation_contract.md` | 归档 | 旧 DTO/硬约束契约（decision_context、15 条硬约束）废弃；新契约 = Runtime Bundle 契约 + ADR-0039/0040 |
| `references/frontend_canvas_interaction_contract.md` | 归档 | 前端交互契约随旧公开协议退役；前端接入由后续工单按 Conversation + Project SSE 重写 |
| `references/image_prompt_contract.md` | 归档 | 生图提示词质量标准属 Creative Skill 领域 |
| `references/blue_whale_architecture.md` | 归档 | 历史架构叙述，被 ADR-0016/0017/0039 取代 |
| `references/foundry_style_orchestration_notes.md` | 归档 | 调研笔记，已完成历史使命 |
| `references/worker_authoring_standard.md` | 归档 | 「worker 文件即角色」编写约定废弃（契约 §9） |

### memory/（3）

| 资源 | 结论 | 去向与理由 |
|---|---|---|
| `memory/workflow_decisions.md` | 归档 | 决策史保留审计价值；判定分层决策 16–21 已被契约 §9 的废弃结论取代 |
| `memory/product_rules.md` | 归档 | 产品方向记录，保留审计价值 |
| `memory/doc_alignment_decisions.md` | 归档 | 文档整理记录，保留审计价值 |

## 公开对话传输协议的唯一权威

- 用户消息唯一命令入口：`POST /api/projects/{projectId}/conversation/messages`；实时与恢复只依赖 Project Snapshot + Project SSE（ADR-0016/0017/0039，契约 §9）。
- 旧 `POST .../agent/turn` 文档契约**废弃且不实现兼容端点**，代码中不存在该 route；旧 PRD 仅作历史记录保留并已加替代标注：
  - `blue-whale-agent-workspace/PRD/AGENT-CONVERSATION-PRD.md`（IJZ7Z7）
  - `blue-whale-agent-workspace/PRD/BACKEND-API-PRD.md`
  - `blue-whale-agent-workspace/PRD/FRONTEND-INTEGRATION-ROADMAP.md`
- 仓库其余位置对 `/agent/turn` 的引用（ADR-0039、契约 §9/§12、`docs/research/`、已合并历史记录 `docs/projects/IJZYUL/`）均为「废弃结论」或「已完成历史记录」语境，不构成第二条待实现公开协议。

## 弱继续/确认冲突的裁决

历史两套口径并存：「低成本弱继续直接推进、高成本二次确认」（`confirmation_gate.md:46-53`、决策 10）与「只说继续一律不推进」（`decision_layer.md:240`、`director_agent.md:50,72` 等）。裁决结果写入 `rule_natural_confirmation`：

- 弱继续（继续/好了/下一步/嗯）**不构成高成本或不可逆动作的授权**——这类动作先用自然语言复述将要授权的内容，得到针对该动作的明确肯定再提议。
- 低成本、可逆的推进可以直接继续，不反复打扰。
- 不引入确认按钮或固定确认门话术；不替用户默认确认。
- 程序化铁闸（GenerationAuthorizationGate / ADR-0036 UserInputRequest、权限、成本、幂等）在 Java 控制面，Rule 只约束模型对话行为。

## 行为评测样例

`blue_whale_agent_worker/tests/test_first_runtime_bundle.py`（build.py 现场组装便携包作夹具，FakeBundleSource 全离线隔离装载）覆盖：

1. 纯咨询不创建 GenerationJob（零动作、零输入请求）。
2. 连续三轮澄清往返合法，无「一次澄清后必须生成」的程序自限。
3. 明确请求直接提出图片 / 视频动作。
4. 未激活 Skill 正文不进模型上下文；触发后经 `read_resource` 逐层读取并产生 on_demand 证据。
5. 弱继续不被误当高成本授权（自然语言再确认样例）。
6. 旧固定分支词汇注入用户消息不影响运行。
7. fail closed：Bundle 缺失、manifest 摘要不符、资源正文篡改、manifest 外 resourceId、初始预算超限。

> 注：以上样例使用脚本化 FunctionModel，验证的是编排管道不阻断目标行为、且对应 Rule 真实注入初始上下文；不构成对提示词引导真实模型行为的评测（真实模型评测属本工单范围外）。

静态校验门禁由 `FirstRuntimeBundleImportIT` 覆盖：便携包导入形成 BundleDraft 并通过现有 JSON Schema、引用闭包、冲突域、摘要与 token 预算校验；发布后导出，资源级逻辑往返可复现。
