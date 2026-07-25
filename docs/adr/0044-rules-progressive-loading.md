# ADR-0044：Rules 渐进式加载与硬信息分层策略

- **状态**：Accepted
- **日期**：2026-07-25
- **决策者**：JJNNReno（经 `/grilling` 会话共同得出）
- **关联**：CLAUDE.md 路由表、`.claude/rules/` 目录约定

## 背景

Claude Code 的 `.claude/rules/*.md` 约定：无 `paths` frontmatter 的文件启动时全量注入，优先级等同 `.claude/CLAUDE.md`；带 `paths` 的改为路径作用域（Claude 读匹配文件时才注入）。

本仓原有三个 rules 文件（`code-intelligence.md` / `git-workflow.md` / `issue-tracker.md`）均无 frontmatter，启动全量注入约 4300 token。CLAUDE.md 路由表标题「按场景查对应规则文件」暗示了渐进式加载意图，但加载机制一直没兑现——路由表与全量注入并存，路由表形同装饰。

仓库的设计哲学是**渐进式加载**（团队隐含共识，此前未写进 ADR）：规则不应每次强制塞进上下文，应由模型在碰到对应场景时自己发现、自己判断是否读全文。issue-tracker.md 原有的「ID 必须动态查、永不硬编码」哲学，与「长期固定 ID 可常驻兜底」的诉求存在张力。

## 决策

### 1. 加载机制：模型自主式（非框架触发式）

规则全文不自动注入，靠 CLAUDE.md 路由表（常驻）+ 模型按场景 **Must Read** 指向的文件。

否决 `paths` 框架触发式：`paths` 只在 Claude「读文件」时触发，git 命令（Bash）、issue 操作（MCP）这类工具操作触发不了，对 git-workflow / issue-tracker 无效。

### 2. 信息分层

| 层 | 内容 | 加载方式 |
| --- | --- | --- |
| 硬信息 | 固定 ID（enterprise / project / program_id） | CLAUDE.md「Gitee ID 兜底常量」常驻 |
| 红线摘要 | 最高红线 8 条、写入前自检 | CLAUDE.md 常驻 |
| 规则全文 | 操作细则、API 用法、命令速查 | 渐进式，模型按需 Read |

### 3. 文件差别对待（按 hook 兜底覆盖度 + 体积 + 漏读代价）

| 文件 | 体积 | hook 兜底 | 决策 |
| --- | --- | --- | --- |
| `git-workflow.md` | ~2400 token | 破坏性红线全覆盖 | 渐进式，移至 `docs/agents/` |
| `code-intelligence.md` | ~1000 token | 漏读不致命（grep 替代） | 渐进式，移至 `docs/agents/` |
| `issue-tracker.md` | ~600 token | API 坑基本无覆盖 | 保留常驻 `.claude/rules/`，精简 ID 段指向 CLAUDE.md |
| `frontend.md` | ~300 token | — | 不动（`paths` 作用域，已工作） |

### 4. ID 处理：兜底常量 + 动态查安全网

CLAUDE.md 写入本仓固定 ID 兜底值（`enterprise_id=16660949` / `project_id=48854568` / `program_id=883843`），标注「以 list API 为准」。日常模型直接用；疑似变更或 401 时用 `list` API 动态查 + `scripts/gitee-resolve-ids.sh` 校验。不推翻原「动态查」哲学，而是把动态查降级为安全网。

澄清：URL 里的 `883843` 是 **program_id**（项目路由），不是 `enterprise_id` / `project_id`——误当后两者传入会触发误导性 401。

### 5. 路由表措辞强化

路由表标题改为「按场景 Must Read 对应规则文件」，并标注每个文件的加载方式（渐进式 / 常驻 / 路径作用域）。

## 后果

- 启动注入量减少约 3400 token（git-workflow + code-intelligence 移出，占原 rules 注入量 80%）。
- 模型需主动 Read 渐进式文件。安全网三层：CLAUDE.md 红线摘要（破坏性核心常驻）+ hook 兜底（破坏性 git 操作硬拦）+ issue-tracker 常驻（API 用法坑无 hook 兜底，靠常驻覆盖）。
- **残留风险**：git-workflow 的流程约束（先 fetch 同步、worktree 入口）hook 只部分覆盖，模型漏读可能撞同步冲突——非破坏性，`scripts/sync-task-from-origin.sh` 兜底恢复。
- ID 兜底常量需在仓库/企业迁移时更新；「以 list API 为准」标注保留校验途径。
- 新 rules 文件默认行为：放 `.claude/rules/` 无 frontmatter = 常驻；加 `paths` = 路径作用域；放 `docs/agents/` = 纯渐进式（靠路由表 Must Read）。

## 备选方案（已否决）

- **paths 框架触发式**：对 git/issue 工具操作触发不了，无效。
- **一刀切全渐进式**：issue API 坑无 hook 兜底，漏读即错（404 / 工单丢失），且 hook 难穷举所有 API 坑形式。
- **全保留常驻，仅做 ID 分层**：未兑现渐进式诉求，路由表仍是装饰。
- **ID 纯硬编码，推翻动态查**：丢失抗变更与防抄错维度的安全网。
