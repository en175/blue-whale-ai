# 通用 Agent 入口

`CLAUDE.md` 是本仓库团队 Agent 规则的唯一权威源。本文件只为 Codex 及其他不会自动读取 `CLAUDE.md` 的 Agent 提供通用索引；不要复制或另行维护一套规则。

任何 Agent 在开始仓库任务前都必须完整读取根目录 `CLAUDE.md`。完成读取之前，禁止修改文件，也禁止执行 fetch、merge、commit、worktree add 等 Git 写入动作。

只读调查、研究、设计和审查不要求创建 Work Tree。任务一旦可能写入仓库内容或改变 Git 状态，必须先遵循 `CLAUDE.md` 的“最高红线”，通过其中规定的唯一入口同步本地 `master` 并创建结构化中文任务 Work Tree；入口成功后，只能在新 Work Tree 中继续写入。

代码结构检索优先使用 Codebase Memory MCP；当前 Work Tree 建立后必须为该路径建立独立索引。具体路由和完整规则均以 `CLAUDE.md` 为准。
