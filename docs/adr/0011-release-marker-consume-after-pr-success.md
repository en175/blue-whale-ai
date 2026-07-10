# ADR-0011：发布标记消费延后到 PR 创建成功后

- **状态**：Accepted
- **日期**：2026-07-10
- **决策者**：JJNNReno（与 Claude Code 经 IK006J 会话共同得出）

## 背景

发布审查包流程（见 [ADR-0010](0010-local-master-is-user-integration-zone.md)）用 Claude Code `PreToolUse` hook（`.claude/hooks/confirm-release-action.sh`）做末梢防护：AI 创建 Gitee PR 前必须先走标准通道 `scripts/publish-review-package.sh --user-authorized` 领一张「发布标记」（TTL 900s，绑定分支 + target），hook 在 `validate_publish_marker` 里校验标记存在 / TTL / 分支匹配。

问题在于消费时机。决策前的实现：`validate_publish_marker` 在 PreToolUse 阶段**校验通过即 `consume_publish_marker`（`rm -f` 删标记）**，随后 `exit 0` 放行。但真正的 Gitee API 调用（`create_enterprise_repo_pull`）发生在 hook 放行**之后**，hook 感知不到 API 成败。

后果：

- 若 PR 创建 API 失败（404 `project_id` 错 / 网络 / 参数错），标记已被删且不回滚。
- 第二次重试 `create_enterprise_repo_pull` 同分支 PR 时，Pre hook 因「无标记」拦截，AI 被迫重跑整个 `publish-review-package.sh`（重新推送 + 重领标记），而非原地重试 API。

「一次发布审查包授权 = 一次 PR 创建尝试」这个隐含语义是错的——失败的尝试也消耗了授权。

## 根因（已验证）

`confirm-release-action.sh` 的 `validate_publish_marker`（PreToolUse）校验通过即 `consume_publish_marker`，随后 `exit 0` 放行。Gitee API 在 hook 之后执行，hook 感知不到成败。Pre 阶段无法可靠判断 API 是否成功——它在 API 执行之前运行。

## 决策

### D1. 单次授权语义 = 一次成功的 PR 创建

明确：发布审查包的单次授权覆盖「一次**成功的** PR 创建」。失败的创建尝试不消耗授权，可原地重试。

### D2. 消费时机从 Pre 延后到 Post（路线 A）

`validate_publish_marker` 在 Pre 阶段降级为**纯校验**：只检查标记存在 / TTL / 分支匹配并放行，**成功路径不再删标记**。标记的实际消费（撕票）延后到 `PostToolUse`：PR 创建成功后，Post 分流从 `tool_input.source_branch` 算出标记路径并 `consume_publish_marker`。

| 路线 | 行为 | 判定 |
|---|---|---|
| **A Post 消费** ✅ | Pre 纯校验放行；PostToolUse（PR 成功后）撕票 | 采纳。PostToolUse 只在工具成功时触发，天然实现「成功才消耗」。 |
| **B Pre 消费 + API 失败回写标记** | Pre 仍删标记，靠额外机制在 API 失败时重新落盘 | 否决。hook 感知不到 API 成败，回写标记需引入跨阶段状态传递，复杂且易再错。 |

**关键技术依据（官方 hooks 文档已查证）**：`PostToolUse` 只在工具成功时触发；失败（含 MCP `isError:true`）走 `PostToolUseFailure`（文档原文「fires for tool calls that throw errors or return failure results」）。故 PostToolUse 分支直接撕票即可，无需在 hook 内判 `isError`——平台契约已把失败路由隔离掉。

### D3. TTL 900s 兜底，不为 100% 撕票加复杂度

漏撕（标记未被 Post 消费）场景靠标记自然 TTL 过期兜底：漏撕的标记最多多活 900s，到期后 Pre 的 TTL 分支会 `consume + block`。不为追求「100% 必撕」引入额外状态机或确认机制——那违背 `CLAUDE.md`「Simplicity First」。

失败后标记残留至 TTL，**正好允许原地重试**；TTL 到则重领。这个特性是 D1 语义的自然落地。

## 考虑过的备选

- **路线 B（Pre 消费 + API 失败回写标记）**：否决——见 D2。Pre 阶段无法感知 API 成败，回写需要把已删标记重新落盘的跨阶段机制，且 Pre 不能区分失败类型（404 / 网络 / 参数错），增加耦合，治标不治本。
- **Post 分支内加 `isError` 判断 guard**：v1 不加。信任平台契约（PostToolUse 不含失败调用）。若实测发现 Gitee MCP 的 `isError` 泄漏进 `PostToolUse`，再加「歧义时默认不消费」guard——风险不对称：标记残留（漏撕）= 良性 / TTL 清理；过早消费（复发）= bug 复发。残留一侧的代价远小于复发。

## 后果

- **正面**：
  - PR 创建失败可原地重试，标记存活至 TTL，无需重跑 `publish-review-package.sh`。
  - 单次授权语义精确为「一次成功的 PR 创建」，与用户直觉一致。
  - Pre 阶段变纯校验，职责更清晰（Pre 管放行，Post 管撕票）。
- **负面 / 代价**：
  - 漏撕场景标记多活至 TTL（最多 900s）。由 TTL + Pre 的 TTL 分支 consume 兜底，不永久有效。
  - **Codex 侧不消费标记**：Codex wrapper（`.codex/hooks/run-claude-pretool.sh`）只适配 `PreToolUse`，本次不为 Codex 加 `PostToolUse`（加了会报错）。Codex 环境下标记不被消费，仅靠 TTL 清理。这是可接受的降级——Codex 的发布动作本就需要用户手动执行或换 Claude Code 环境（见 `docs/agents/commit-and-review.md` Codex 段）。
  - Pre block 路径（无票 / 过期 / 不匹配 / draft / 错 target）工具不执行 → Post 不触发 → 不消费（正确）。

## 实现要点

- `confirm-release-action.sh`：
  - `validate_publish_marker` 成功路径移除 `consume_publish_marker`；TTL 过期分支的 consume + block 保留（作过期清理）。
  - 新增 Post 分流：`PostToolUse` + `tool_name=mcp__gitee-ent__create_enterprise_repo_pull` → 从 `tool_input.source_branch` 经 `marker_path_for_branch` 算路径 → `consume_publish_marker`；`source_branch` 非空 guard；`exit 0`（Post 不能阻断已执行的工具）。
- `.claude/hooks/lib/pretool.py`：`value()` 加顶层 key 白名单（含 `hook_event_name`），让 Post 分流能读到事件名。
- `.claude/settings.json`：加 `PostToolUse` matcher `mcp__gitee-ent__create_enterprise_repo_pull` → `confirm-release-action.sh`。

## 参考

- 工单来源：IK006J（发布标记消费延后到 PR 创建成功后）
- 上游决策：[ADR-0010](0010-local-master-is-user-integration-zone.md)（用户本地集成区 / 发布包装分支）、[ADR-0006](0006-sync-mechanism-auto-block.md)（规范前置 → Hook 兜底）
- 代码实现：`.claude/hooks/confirm-release-action.sh`、`.claude/hooks/lib/pretool.py`、`.claude/settings.json`
- 平台依据：Claude Code 官方 hooks 文档（`PostToolUse` / `PostToolUseFailure` 触发条件）
