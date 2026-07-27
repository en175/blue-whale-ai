# Video Agent Canvas Workflow

> **⚠️ 已替代（2026-07-24，IK2D8R）**：本文件已**归档**，不再是运行时实现权威。固定 stage 硬停/软过流程废弃；完整广告编排属 Creative Skill 领域。运行时以 `runtime-bundle/` 为准；目录级说明见 `skill/SKILL.md` 顶部横幅，迁移结论见 `docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md`（workflows/ 段）。

目标：把用户一句自然语言视频需求，编排成可确认、可修改、可续跑的画布式创作流程。

## 阶段总览

| 阶段 | 名称 | 主要 Agent | 产物 | 确认类型 |
|---|---|---|---|---|
| 0 | 承接 decision_branch | Director | 路由到对应 stage | 否 |
| 1 | Brief 收集 | Brief | 最小创作 Brief | **硬停** |
| 2 | Skill 匹配 | Skill Selector | 创作套路 / Skill | 软过 |
| 3 | 阶段计划 | Director | canvas stage plan | 软过 |
| 4 | 脚本分镜 | Storyboard | 脚本、分镜、镜头表 | **硬停** |
| 5 | 首批视觉 | Generation | 关键帧 / 风格图 / 商品图 | **硬停** |
| 6 | 视频生成 | Generation | 视频任务或视频结果 | **硬停** |
| 7 | 审核完成 | Review | 质量检查、交付摘要 | 软过 |

> **硬停** = turn 边界，必须用户明确确认才推进；**软过** = turn 内自动推进，用户可随时打断。详见 `confirmation_gate.md`。
> **硬停成本等级**（决策 10）：Brief / 脚本分镜 / 首批视觉 = 低成本硬停（弱继续直接推进）；视频生成 = 高成本硬停（弱继续二次确认）。详见 `confirmation_gate.md` 弱继续。
> **Stage 0 承接 `decision_context.decision_branch`**(turn 前置已由后端算好,见 `decision_layer.md`),按 branch 路由到对应 stage。原「L2 意图识别」概念已废除——全场景(轻量编排 + Full Canvas)复用同一套 `decision_branch`,L1/L2 统一。

## Stage 0：承接 decision_branch

Full Canvas 进来时,turn 前置已算好 `decision_context.decision_branch`(见 `decision_layer.md`)。Stage 0 不再独立做意图识别,只承接并路由:

- `new_task`(`suggested_route=full_canvas`)→ 进入 Stage 1 Brief 收集
- `product_switch` / `revise_canvas` / `confirm_pending` → 按主 Agent switch 动作处理(读 `product_switch_p0.md` / `rules/revise_canvas.md` / 确认门四分类),需要时回到对应 stage
- 其他 branch(`generation_in_progress` / `generation_failed` / `consult` / `clarify`)→ 主 Agent 直接处理,不进 Full Canvas stage 流

阻断:
- `decision_branch=clarify` 时,不启 workflow,先问一句确认。

## Stage 1：Brief 收集

目标：只收集当前启动创作必须的信息。

最低信息：
- 视频目标：广告 / 社媒 / 短剧 / 品牌片 / 其他
- 主体：产品、人物、服务或故事对象
- 目标平台或时长范围
- 是否有参考素材或产品图
- 当前最重要的卖点或情绪方向

如果缺失，只问最关键的 1-3 个问题。

输出：
- `brief_card`
- `missing_fields`
- `assumptions`

确认门：
- 展示 Brief 摘要，让用户确认或修改。

## Stage 2：Skill 匹配

目标：选择最适合当前 brief 的创作套路。

可选 Skill 类型：

| Skill 类型 | 适合场景 |
|---|---|
| product-ugc-ad | 产品种草、达人口吻、转化广告 |
| product-demo | 功能演示、卖点证明、测评 |
| brand-tvc | 品牌质感、TVC、商业大片 |
| short-drama | 短剧、剧情、反转故事 |
| social-trend | 社媒热点、meme、互动内容 |
| url-to-video | 从链接、商品页、网页内容生成视频 |
| storyboard-to-video | 用户已有脚本或分镜，直接转视频 |

输出：
- `selected_skill`
- `skill_reason`
- `risk_note`

确认门：
- 告诉用户推荐 Skill 和理由，允许用户改选。

## Stage 3：阶段计划

目标：把创作拆成可执行阶段，不一次性跑完。

计划格式：

```text
1. 脚本和分镜
2. 首批关键视觉
3. 视频生成
4. 审核与修改
```

输出：
- `stage_plan`
- 每个 stage 的输入、输出、确认点

确认门：
- 用户确认计划后，才进入脚本分镜。

## Stage 4：脚本分镜

目标：先完成内容结构，不直接烧生成资源。

输出：
- 完整脚本
- 分镜表
- 关键帧清单
- 每个镜头的生成提示方向

确认门：
- 用户必须确认脚本/分镜后，才进入视觉生成。

修改规则：
- 用户只改局部时，只重写对应镜头。
- 用户说方向不对时，回到 Stage 2 或 Stage 3。

## Stage 5：首批视觉

目标：先生成最关键的视觉锚点，而不是直接生成整条视频。

如果画布已有用户上传图片，先进入 `image_understanding.md`，得到 `asset_understanding` 后再生成视觉。

首批视觉包括：
- 主视觉关键帧
- 产品展示图
- 角色/场景风格图
- 片头 hook 画面

生成首批视觉时，必须进入 `image_generation_prompt.md`，由 Image Prompt Agent 和 Prompt Optimizer Agent 生成可执行提示词，再交给 Provider。

输出：
- `canvas_nodes`：image / storyboard_frame / style_reference

确认门：
- 画布有 ready 节点后，用户明确满意才进入视频生成。

## Stage 6：视频生成

目标：基于已确认脚本、分镜和视觉锚点生成视频。

如果目标生成模型是 Seedance 2.0：

- 读取 `skill/references/seedance_prompt_optimizer.md`。
- 使用 `@图片N` / `@视频N` / `@音频N` 引用素材。
- 使用 `<主体N>` 绑定需要稳定复用的人物、产品或角色。
- 简单视频使用一段式提示词。
- 多镜头、跨场景、多主体视频使用三段论：总体设定 + 镜头分镜 + 风格约束。
- 保留已确认 Skill 的创意结构，不得因模型提示词语法改变视频策略。
- 必须加入必要稳定约束：画质、人物/产品稳定、水印和 Logo 兜底；多人场景加入防重复人物约束。

输出：
- 视频任务卡
- 视频结果卡
- 失败或重试原因

确认门：
- 视频 ready 后必须等待用户确认。

## Stage 7：审核完成

Review Agent 检查：
- 是否符合 brief
- 是否符合选定 Skill
- 是否有明显跳镜、跑题、卖点缺失
- 是否有需要提醒用户的风险

输出：
- 最终交付摘要
- 可选修改建议
- 后续可复用资产

## 全局阻断条件

任何阶段出现以下情况，必须停住：

- 当前阶段缺少必要信息
- canvas 中没有对应 ready 结果
- 用户表达不满意
- 用户要求换方向
- 生成失败
- Skill 与用户需求冲突

## 全局禁止

- 不允许从 Stage 1 直接跳到 Stage 6。
- 不允许在没有脚本/分镜确认时生成完整视频。
- 不允许用户只说“继续”就自动确认。
- 不允许重跑已确认阶段，除非用户明确要求修改。
- 不允许生成模型语法覆盖已确认的创意 Skill。
