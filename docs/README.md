# 项目文档体系（docs/）

本目录是项目文档**唯一权威区**。新增文档必须按分区归位——**禁止在仓库根目录或代码目录随意新建文件夹**（历史教训：`blue-whale-agent-workspace/` 杂烩目录）。

本仓代码探索规则例外：根 `agent-rules/code-discovery.md` 按规则归位协议承载详细规则；`docs/agents/code-intelligence.md` 仅作工具导航，不重复维护行为规则。

## 文档分区总览

| 分区 | 内容 | 主要作者 |
| --- | --- | --- |
| `docs/projects/<工单号>/` | 需求 / PRD / 验收文档（按工单组织） | 产品经理 |
| `docs/skills/` | 产品技能资产（创作技能库 / 封面图 / 技能规格） | 产品经理 |
| `docs/specs/` | 规格契约（设计 / 实现计划 / schema） | 产品 + 工程 |
| `docs/adr/` | 架构决策记录（ADR-NNNN） | 工程 |
| `docs/context/` | 上下文快照（`NNN-context.md`，序号规则） | 全员 |
| `docs/research/` | 技术研究 | 工程 |
| `docs/agents/` | 团队 Agent 规则（规则源，勿乱动） | 工程 |

## 产品经理写作指南

### 在哪写

| 要写什么 | 放哪里 | 文件名 |
| --- | --- | --- |
| 需求 / PRD / 验收文档 | `docs/projects/<工单号>/` | `<工单号>-<主题>.md` |
| 创作技能定义 + 封面图 | `docs/skills/library/` | `raw/cn<编号>-<名称>.md` + `covers/cn<编号>-<名称>.png` |
| 技能规格（产品行为） | `docs/skills/` | `<技能名>-spec.md` |
| 接口 / 契约类 | `docs/specs/` | `<日期>-<主题>.md` |

**硬性要求**：
- 需求/PRD 必须有工单号（Gitee 工单），目录按工单号组织；没有工单先建工单
- 禁止：在根目录、`blue_whale_web/`、`apps/`、`packages/` 等代码目录新建产品文档文件夹
- 禁止：用连字符目录名在根目录建"workspace"式的杂烩目录

### 怎么写

每篇文档必备字段（参考 `docs/context/README.md` 形态 A/B）：

1. **标题**（H1）：动宾或名词短语，说清内容（如"视频导演呈现与交互规格"）
2. **日期**：`YYYY-MM-DD`，写在 `## 时间` 下
3. **背景 / 目标**：为什么做、要达成什么
4. **正文**：按主题分节，表格优先
5. **验证 / 关联**（推荐）：验收方式、关联工单/提交

### 怎么用（写完怎么落盘）

1. `docs/**/*.md` 是**散文文档**（ADR-0025 例外区）：可在 master 直接编辑
2. 落盘命令（在仓库根目录）：
   ```bash
   scripts/commit-spec-on-master.sh -m "<中文描述>"
   ```
   自动提交到本地 master，**不 push、不开 PR**
3. 素材类（png/json/schema）**不是散文**：随功能 PR 提交，或请工程同事走 worktree 流程
4. 写完后在工单评论里附文档路径，供评审

## 维护规范

- 序号类文档（`docs/context/`、`docs/adr/`）遵守各自 README 的编号规则，缺号留痕不补
- 已废弃文档归档到 `docs/archive/`，不在活跃区留存
- 分区新增/调整需团队评审，先改本文档再执行
