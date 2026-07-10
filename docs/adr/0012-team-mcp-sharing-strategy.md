# ADR-0012：团队 MCP 工具共享策略与 .mcp.json 边界澄清

- **状态**：Accepted
- **日期**：2026-07-10
- **决策者**：JJNNReno（与 Claude Code 经 IK006M 会话共同得出）
- **来源**：IK006M

## 背景

[ADR-0003](0003-no-direct-push-to-master.md) §5 已决策：`.mcp.json` 加入 `.gitignore`，根因是个人本机绝对路径（`/Users/.../.local/bin/...`）不该进全仓共享配置——成员 pull 后 MCP server 启动失败。本 ADR 不重述「不进仓」决策，而是闭合 0003 §5 留下的两个尾巴：

1. **承诺的 onboarding 落点缺失**：0003 §5 写「MCP 配置说明写进 `README.md`，由团队成员各自按本机路径配置」，但仓库根目录从未创建 `README.md`。
2. **团队怎么共享未回答**：`.mcp.json` 不进仓后，团队 MCP 工具能力如何共享给所有成员，0003 §5 没覆盖。

现状是：仓库有两个 MCP 工具——`codebase-memory-mcp`（CBM，用户级配置，command 为个人本机绝对路径）与 `gitee-ent`（项目级 `.mcp.json`，本地 gitignored，含明文访问 token）。两者都无法经 `.mcp.json` 进仓共享，但团队共享**实际已落地**：靠进仓的 hooks + rules，而非 `.mcp.json`。本 ADR 记录这个已落地的事实并闭合上述两个尾巴。

## 决策

### 1. 团队 MCP 工具共享 = 进仓 hooks + rules，不靠 `.mcp.json`

确立模式：**行为编码进版本控制的 hooks/rules，机器特定配置留给成员各自配**。

CBM 的代码发现增强（`cbm-discovery-gate.sh`，PreToolUse on `Grep|Glob`，注入图谱上下文、永不拦截）和协议提醒（`cbm-session-reminder.sh`，SessionStart 打印 CBM FIRST 代码发现协议）随仓库分发；CBM 二进制和 server 注册成员各自装（用户级 `~/.claude.json`）。两个 hook 都有双层逻辑——用户级已装同名 gate 则让位、否则进仓脚本兜底——实现零摩擦共享且不覆盖个人定制。

### 2. 两类 MCP 工具，两种分发边界

| 工具 | 二进制位置 | 配置位置 | 能否进共享 `.mcp.json` | 共享方式 |
|---|---|---|---|---|
| CBM（codebase-memory-mcp） | 用户级 `~/.local/bin`（个人绝对路径） | 用户级 `~/.claude.json` | **不能**（路径问题） | 进仓 hooks 兜底 + rules 文档 |
| gitee-ent | `npx` 拉取（无路径问题） | 项目级 `.mcp.json`（本地 gitignored） | **不能**（含明文 token） | onboarding 文档 + 各成员本地配 |

### 3. 兑现 ADR-0003 §5：新建根 `README.md`

核对结论：`code-intelligence.md`「团队 onboarding」章节已充分覆盖 CBM 接入（安装 / 配置 MCP server / 重启 / 建索引 / worktree 独立索引 / 降级路径），无缺口。

0003 §5 承诺「MCP 配置说明写进 `README.md`」。本 issue 新建仓库根 `README.md`，含「MCP 工具配置」节：CBM 指向 `.claude/rules/code-intelligence.md`「团队 onboarding」章节；gitee-ent 给出本地 `.mcp.json` 配置结构（server 命令、两个 env）。兑现承诺，闭合尾巴 1。

### 4. gitee-ent onboarding 缺口登记

核对发现：仓库内零文档说明如何获取 `GITEE_ENT_MCP_ACCESS_TOKEN`（Gitee 企业版后台哪生成 MCP access token）。本 issue 无法闭合此缺口（无该信息），根 `README.md` 的 gitee-ent 配置仅给出结构，token 获取流程标注「待补」。建议开 follow-up issue 由 maintainer 补全。

## 考虑过的备选

- **`.mcp.json` 解禁整体进仓**：**否决**——CBM 个人绝对路径 + gitee-ent 明文 token 双重独立阻断。即使解决其一，另一根因仍在。
- **密钥抽到 `.env` 后 `.mcp.json` 模板化进仓**：技术部分可行，但收益 < 复杂度，且 CBM 路径问题使整体解禁仍不可能。保留评估（见 [密钥抽离评估报告](../research/mcp-secrets-extraction-evaluation.md)），本期不实施。

## 后果

- **正面**：
  - 团队 MCP 行为靠版本控制 hooks/rules 共享，不依赖 `.mcp.json` 进仓；
  - 两类工具的分发边界（路径 vs token）清晰可查；
  - ADR-0003 §5 的两个尾巴闭合（README 落地 + 共享策略记录）。
- **负面 / 代价**：
  - gitee-ent onboarding 依赖 maintainer 提供 token 获取流程，未完全闭合；
  - 新成员需手动配置本地 `.mcp.json`（靠根 README + `code-intelligence.md` 指引）；
  - `.mcp.json` 含明文 token 存于工作副本（未进仓，明文风险见评估报告安全提醒）。

## 实现要点

均已上线，本 ADR 为事后记录：

- `.claude/hooks/cbm-discovery-gate.sh`（PreToolUse `Grep|Glob`，注入图谱上下文不拦截，用户级已装则让位）
- `.claude/hooks/cbm-session-reminder.sh`（SessionStart 打印 CBM FIRST 协议）
- `.claude/rules/code-intelligence.md`（含「团队 onboarding（CBM 不随仓库分发）」章节）
- `.claude/settings.json`（两个 hook 的注册）
- `README.md`（本 issue 新建，兑现 0003 §5）

## 参考

- 上游决策：[ADR-0003](0003-no-direct-push-to-master.md) §5（`.mcp.json` 移出仓库）
- 相关规则：`.claude/rules/code-intelligence.md`
- 评估材料：[密钥抽离评估报告](../research/mcp-secrets-extraction-evaluation.md)
- 工单来源：IK006M
