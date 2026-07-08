# Doc Alignment Decisions

> 2026-07-06 初版 + 同日迁移(根 SKILL.md 删除、运行时决策迁入 director_agent.md、topview→Blue-Whale、name 改 blue-whale-agent-canvas)。记的是容易再被搞混的结论,不记具体改了哪些字(那些已落到文件里)。

## 索引源要同步(改文件时必看)

skill/ 下增删改文件时,以下 **3 处索引要一起更新**:

- `README.md`(目录结构表 + tests 清单)
- `skill/SKILL.md`(资源导航表)
- `agent-workflow-visual.html`(文件树区块)

校验命令:提取各文件引用的 `.md` basename,和实际 `find` 结果比对。

## 主 Agent 命名与权威文件

- **正名:主 Agent**。别名 Director Agent / CEO 路由器 / 主控,都指同一个角色。
- **主 Agent 唯一权威**:`skill/workers/director_agent.md`——角色定义 + 运行时决策 + 状态机 + 路由全部收于此。其他文档只引用,不重复定义。
- 历史:原根 `SKILL.md` 承载的运行时决策已迁入 director_agent.md;根 SKILL.md 已删除;workspace 顶层入口由 `CLAUDE.md` 承担。

## 单一 Skill 入口(原双层已合并)

- 唯一 Skill 入口:`skill/SKILL.md`(`name: blue-whale-agent-canvas`)= 可打包安装的 Skill 入口 + 资源导航。
- workspace 顶层无独立 SKILL.md。顶层入口由 `CLAUDE.md` 承担(顶部路标指向 director_agent.md + skill/SKILL.md)。
- `README.md` 是给人看的项目总览,与 skill/SKILL.md 不是同一类东西。

## P0 / P1 历史持久化边界(容易误判)

- **P0 已存对话 messages**:`GET /api/projects/{id}` 返回整 Project 快照(canvas nodes + messages + active_jobs)。刷新恢复画布 + 对话 + 进行中任务。
- **P1 才是结构化历史系统**:messages 与 agent_events 分离、conversation_summary、content_versions、version_index、历史资产引用、版本恢复。见 `FRONTEND-INTEGRATION-ROADMAP.md` 模块 10。
- 别再误以为「P0 不存对话」或「P1 只是前端美化」。

## 生成路径口径(两入口为主口径)

- **两入口**是当前主口径:BottomDock 直生 / Agent 对话。路由判定见 `skill/rules/generation_route_decision.md`。
- **BottomDock 直生**承担 Direct Image / Direct Video / Image-to-Video:纯参数透传,零 Prompt Optimizer,零 understanding。
- **Agent 对话**按 `decision_branch` 收口:lightweight / full_canvas / prompt_only / revise_canvas / product_switch / consult / confirm_pending / generation_in_progress / generation_failed / clarify。
- 旧的“三链路 / 四链路”只能作为历史产品形态说明,不能再作为运行时主口径。

## 文档间权威关系(避免循环引用)

- **字段定义权威**:`skill/references/backend_implementation_contract.md`(Agent Turn / Canvas Node / ChatMessage variant / Stage / Workflow Run)。
- **决策权威**:`FRONTEND-INTEGRATION-ROADMAP.md` 第 125 行起「已锁定产品决策」。
- **主 Agent 唯一权威**(决策 + 角色):`skill/workers/director_agent.md`。
- 其他文档只引用,不重复定义。

## 已修字段/命名(别改回去)

- Canvas Node 引用 Asset 用 **`asset_refs`(复数)**,不是 `asset_ref`。
- `turn_done` 用 **`current_stage_id`(id)**,不是 `current_stage`(中文名)。
- workflow.status 含 `failed`(五类);stage.status 含 `skipped`。
- `optimized_prompt`(原始)**永不进 message**;直生链路给用户看的是 `optimized_prompt_preview`(友好版)。prompt_optimizer_agent 必须产出后者。
- 内部字段(`rules_used` / `handoff_to` / 提示词语法参考)归 `trace_event`,不进 message content。

## 留给后端实现的契约缺口(待补)

- **GenerationJob**:contract 只提了名字,字段清单未定义。
- **4 个 ChatMessage variant 缺 content schema**:`asset_understanding` / `skill_recommendation` / `prompt_draft` / `review`。
- **`awaiting_confirm` 作为 node.status 是死值**:contract 定义了,但 Job→node 映射没有任何路径产生它。待决策:删掉 node.status.awaiting_confirm(确认门只认 ready),还是补产生路径。当前未定,先不动。
- `skill_selector` 输出字段曾含 `fit_score`(全 workspace 无定义),已删。
