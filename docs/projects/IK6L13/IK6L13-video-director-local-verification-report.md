# video-director-local 本地 cc 编排完整性验证报告与断点清单

## 时间

2026-08-07

## 背景 / 目标

map IK6L13（[Wayfinder] video-director-local 本地 cc 编排完整性验证）的终点产物：验证 `video-director-local`（本地 Claude Code 视频导演 skill，止于提示词交付包）编排在本地 cc 是否完整跑通——**结构**（文件 / 路径 / 路由表分发目标）+ **链路**（路由 / 直生 / 完整创作 / 拆解复刻 / 生图 5 条实跑）双重验证。断点只记不修，修复另开 effort。

- 验证对象：`~/.claude/skills/my/video-director-local/`（T1 已同步 = master 权威源 `docs/skills/video-director-local/`）
- 验证方式：T2 静态走查（agent）+ T3–T7 动态实跑（用户新 cc session 真人执行）

## 总体结论

**编排整体可用。** 结构完整性 8/8 维度通过；5 条链路全部实跑出完整产物；全程止于提示词（无生成 API 调用）、已确认 Skill 未被模型语法覆盖（两条红线全守住）。共记录 **10 条断点：静态 1 / 动态 9，严重度中 2 / 轻微 8**，无阻断性断点。

> 补记（2026-08-07）：**B1 已由 IK6TWY 修复并验收**（commit 99c3950d / 本地 master b7366067，`SKILL.md:25` 改请求式/问句式双路径），剩余 9 条归修复 map IK76NL。

## 子票结果一览

| 票 | 内容 | 结果 |
| --- | --- | --- |
| T1 (IK6L1O) | 同步本地 cc skill 到 master | ✓ rsync + diff 干净，progressive-disclosure 新版生效 |
| T2 (IK6L2H) | 静态结构走查 | ✓ 8/8 维度通过；唯一断点 S1（轻微写法） |
| T3 (IK6L2L) | 路由层实跑（8 种意图） | 7/8 命中；断点 B1（推荐意图入口授权方式退化） |
| T4 (IK6L2Z) | 直生链路实跑 | ✓ 2/2 用例；断点 B2/B3（轻微） |
| T5 (IK6L33) | 完整创作链路实跑 | ✓ 5/5 阶段 + 两确认门串行；断点 B4/B5 |
| T6 (IK6L34) | 拆解复刻链路实跑 | ✓ 全链路（含抽帧诚实降级）；断点 B6/B7/B8 |
| T7 (IK6L35) | 生图提示词链路实跑 | ✓ 4/4 判据；断点 B9（轻微） |

## 断点清单（统一编号）

按「静态/动态、严重度、所属文件」归类，供修复 effort 定优先级。

| # | 静/动 | 严重度 | 所属文件 / 环节 | 描述 | 来源 |
| --- | --- | --- | --- | --- | --- |
| S1 | 静态 | 轻微 | `agents/prompt-optimizer.md:52` | 模型语法表中 `image_to_video` 行用裸文件名，同文件其余处为 `../references/` 相对路径，写法不一致；语义可解析，不影响运行 | T2 |
| B1 | 动态 | **中** | `SKILL.md` 路由规则（:25 附近） | 「创作方法推荐」意图规则「一句话告知即进 full-canvas（用户可随时换）」未生效，退化为问 3 件事等授权、被动进入；纠正后进入链路无损。**已修复**（IK6TWY，请求式/问句式双路径） | T3 |
| B2 | 动态 | 轻微 | `workflows/direct-generation.md` | 补问过度：描述已明确的请求连环两轮菜单式补问，且以营销框架反复推视频方案；违反「描述够则直接默认补全」规则 | T4 |
| B3 | 动态 | 轻微 | `workflows/direct-generation.md` | 视频默认参数（9:16 · 5s · 720p）串入静态图请求的输出 | T4 |
| B4 | 动态 | **中** | `workflows/full-canvas-creation.md` | 阶段 4→5 未自动续跑：交付包产出后停在等指令，需用户手动触发交付前自检；五阶段编排应自动衔接 | T5 |
| B5 | 动态 | 轻微 | full-canvas 链路产出文案 | 笔误 2 处：Brief 摘要「草草带货」（应为种草带货）、脚本摘要「核心心钩子」多字 | T5 |
| B6 | 动态 | 轻微 | `workflows/video-decode-replicate.md` | faithful 复刻后版权轻提示未触发；规格条件「faithful 且商用」与验证判据「faithful 自带轻提示」表述不一致——先对齐规格再定修不修 | T6 |
| B7 | 动态 | 轻微 | video-decode-replicate 复刻段呈现 | Brief 预填与「Skill 高置信直推 + 一句话告知」呈现不可见，疑似收进思考过程；复刻链路阶段透明度问题 | T6 |
| B8 | 动态 | 轻微 | video-understanding 输出契约 | 理解策略标签实际输出 `frame_extraction`，越出 spec 两态枚举（direct_multimodal / frame_plus_user_narration）；行为本身合理（自主降级），标签需回 spec | T6 |
| B9 | 动态 | 轻微 | `workflows/image-generation-prompt.md` | 生图卡「将用于：镜头N」标注与终版分镜错位——喂回后分镜重排未回写卡片标注；不影响生成 | T7 |

## 修复优先级建议（供修复 effort 参考）

1. ~~**B1**（中）~~ — 已由 IK6TWY 修复并双路径验收，移出清单。
2. **B4**（中）— 编排自主性缺口，用户需记得手动触发末段；修阶段衔接指令。
3. **B2 / B3**（轻微但高频）— 直生是轻量入口，补问过度与参数串味直接伤体验。
4. **B6**（先规格对齐）— 决策项：版权轻提示的触发条件以哪份文档为准，定了再改。
5. 其余轻微（S1 / B5 / B7 / B8 / B9）— 顺手修级别，可合并一批。

## 红线核查（全 map 汇总）

- 止于提示词、未调生成 API：T4 / T5 / T6 / T7 全部 ✓
- 模型语法不覆盖已确认 Skill：T5 ✓（UGC-Ads-Video 结构全程保持）
- 视频理解不假装看懂：T6 ✓（抽帧失败如实标注进 uncertainties）

## 关联

- map：IK6L13（[Wayfinder] video-director-local 本地 cc 编排完整性验证）
- 子票：T1 IK6L1O / T2 IK6L2H / T3 IK6L2L / T4 IK6L2Z / T5 IK6L33 / T6 IK6L34 / T7 IK6L35 / T8 IK6LQV（本票）
- B1 修复：IK6TWY（closed，先于本报告归档完成）
- 后续：断点修复 = map IK76NL（剩余 9 条），输入 = 本文档断点清单
