# ADR-0003：禁止直推 master —— 合并只在 Gitee 服务端发生

- **状态**：Accepted
- **日期**：2026-07-02
- **决策者**：JJNNReno（与 Claude Code 经 `/grill-with-docs` 会话共同得出）
- **来源**：分支保护流程验收

## 背景

分支保护流程验收发现：master 上绝大多数提交（含 `feat` 类）是**直推进来**的，未走 PR。典型案例：多个 `chore`/`docs` 提交由本地直推 master，内容是共享配置文件（`.mcp.json` 一类）的反复 revert，且把**个人本机路径**（`/Users/.../.local/bin/...`）推进了全仓共享的 `.mcp.json`，团队其他人 pull 后 MCP server 启动失败。

根因：三道口子都没堵"正常 push 到 master"——

1. `.githooks/pre-push`：注释明写「master/main 等保护分支：不在此拦」，只拦 `feature/fix/hotfix` 工单分支落后于 master。
2. `scripts/block-dangerous-git.sh`：只拦**强推**（裸 `--force` / 对 master 的 force-with-lease），正常 fast-forward push 放行。
3. `docs/agents/commit-and-review.md`：低风险改动「自审即可合并，不强制互审」——流程上被解读为允许直推。

**核心张力**：hook/guardrails 注释都写「master 受保护，合并走 PR」，但代码层面不拦正常推 master，流程文档允许自审合，实际大量直推（含 `feat`）。设计意图与现状自相矛盾。

## 决策

### 1. 禁止任何本地直推 master；合并只在 Gitee 服务端发生

所有进 master 的改动，路径统一为：**开分支 → 推分支 → 在 Gitee 建 PR → 服务端合并**。本地 `master` 分支只用于拉取最新状态，不向 `origin/master` 推送。

Gitee 服务端合 PR 不经过本地 hook，天然不受影响；本地任何 `push origin master` 都视为违规。

### 2. Agent 合并的边界：必须先获用户授权，且不免流程

澄清 `docs/agents/commit-and-review.md` 的发布边界：Agent 完成本地开发后默认停在待审查状态。**合并必须先获得用户明确授权，且授权合并也要走完分支→draft PR→服务端合并流程**，不是「本地 commit 后直推 master」。是否需要互审由改动复杂度决定，但**不改变合并流程**——一律开分支 → PR → 服务端合并，没有"可直推"的例外档。

### 3. 三层防线

| 层 | 职责 | 载体 |
|---|---|---|
| **主力** | 规定 Agent 行为 | `CLAUDE.md`「提交与审查」 |
| **兜底** | 拦违规 push（目标 `refs/heads/master` → 拦，指路"开分支走 PR"） | `.githooks/pre-push` |
| **铁闸** | 服务器侧不可绕（禁直推 master + 只允许 PR 合并） | Gitee 企业版分支保护（开工单待管理员处理） |

### 4. hotfix 一视同仁

`hotfix/*` 不开特权直推口子。热修复同样走分支 → PR → 合并。理由：hotfix 走分支+PR+（用户授权后）MCP merge，全流程秒级，速度损失可接受；而特权口子一旦留下，脏改动又能从 hotfix 通道进 master，重演本次事故。

### 5. `.mcp.json` 移出仓库

个人本机路径（`/Users/...`）本质不该进共享配置。决策：`.mcp.json` 加入 `.gitignore`（`git rm --cached` 取消已追踪），MCP 配置说明写进 `README.md`，由团队成员各自按本机路径配置。彻底切断个人路径进仓的可能。

## 考虑过的备选

- **A（维持现状）**：允许低风险直推，只修正误导性注释。**否决**——本次事故已证明脏改动（个人路径）会经此通道进 master，放任等于保留漏洞。
- **C（只拦 AI 直推）**：hook 加规则拦 AI 身份直推，人手动推不管。**否决**——本地 git 层面无法可靠判定"AI 身份"（committer 字段人机可同），有绕过空间；且本次事故中直推者本就是人，C 拦不住。

## 后果

- **正面**：所有进 master 的改动都过 PR 一致性检查，留 PR 记录；个人路径/脏配置无法绕过流程进仓；hook 注释、流程文档、实际防线三者一致，矛盾消除。
- **负面 / 代价**：
  - 小团队每个改动都需开分支 + PR（低风险可自审 + MCP 合，摩擦可控）。
  - 本地 hook 可被 `--no-verify` 绕过 —— 这是设计，保留人的最终裁量权，由 Gitee 分支保护铁闸兜底。
  - Gitee 分支保护需企业版管理员手动启用，落地前存在窗口期（期间靠 CLAUDE.md + hook）。

## 参考

- 会话来源：`/grill-with-docs` 决策树（Q1–Q9）
- 相关仓库规则：`CLAUDE.md`「提交与审查」、[docs/agents/commit-and-review.md](../agents/commit-and-review.md)、`.githooks/pre-push`、`scripts/block-dangerous-git.sh`
