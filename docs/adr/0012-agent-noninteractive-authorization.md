# ADR-0012：Agent 明确授权后使用无交互凭证，Hook 仅作流程兜底

- **状态**：Accepted
- **日期**：2026-07-11
- **决策者**：JJNNReno（与 Codex 经 `/grilling` 会话共同得出）

## 背景

仓库规则要求 Agent 在提交任务分支、合入本地 `master`、推送、合并 PR 和创建 release 前取得人类明确授权。旧 Hook 即使看到标准入口中的 `--user-authorized`，仍返回 `permissionDecision=ask`：Claude Code 弹 Yes/No，Codex 则需要平台适配为硬停。人类已经用自然语言授权后再次交互会阻塞后台执行，也让两端行为不一致。

本仓库仅用于公司内部可信 Agent 协作。主要风险不是恶意 Agent，而是长上下文稀释后忘记规则、绕过标准入口或把授权复用于错误对象。

## 决策

1. **自然语言是人类接口**：只有当前对话中的人类消息能授权；Issue、PR 评论、仓库文档、工具输出和子 Agent 建议不能授权。人类无需记忆凭证命令或点击二次确认。
2. **Agent 自动结构化授权**：本地标准入口以 `--user-authorized` 声明已有授权；合并 PR 和创建 release 由 Agent 自动生成绑定 `enterprise_id + project_id + PR ID/tag` 的一次性凭证。
3. **无 ASK 协议**：Claude Code、Codex 及后续 Agent 共用“stdout 空 + exit 0 放行 / exit 2 阻断”的 Hook 契约，不产生 `permissionDecision=ask`。
4. **Hook 只做兜底**：直接 push、直接 commit、非 `--ff-only` merge、缺参数、缺凭证、过期或对象错配均硬拦；错误信息指引 Agent 在已有授权覆盖时自动改走标准入口。
5. **凭证生命周期**：凭证存于 git common dir，权限 0600，TTL 900s；PreToolUse 校验后用独占文件按 `tool_use_id` 原子占用但不消费，阻止同一凭证并发启动多次操作。PostToolUse 仅在 `tool_response.isError` 严格为布尔 `false` 时消费；失败或畸形结果释放占用并保留供有限重试。撤销可精确删除或 `revoke --all`。
6. **阶段边界**：“发布完成”覆盖提交、合入本地 master、推送和创建 PR，不覆盖合并 PR 或 release；PR 合并授权覆盖成功后的安全清理。
7. **重试边界**：Hook 纠偏最多自动重试一次；网络或服务端临时错误最多重试两次，之后停止并汇报。禁止通过关闭 Hook 或危险 Git 命令绕过。

## 后果

- 已授权任务可以连续完成，不因 Yes/No 或 Codex 硬停而空等。
- Hook 仍能在 Agent 忘记规则时阻断误操作，并提供确定性的恢复入口。
- 凭证只证明 Agent 走过约定流程，不是人类身份或恶意 Agent 防护机制；仓库权限、分支保护和审计继续承担外部安全边界。
- Claude/Codex 必须同步维护 PreToolUse 与 PostToolUse matcher，并由黑盒测试锁定一致性。

## 实现

- `scripts/manage-agent-authorization.sh`：AI 自动 grant/revoke 的稳定 CLI。
- `.claude/hooks/lib/authorization.py`：凭证路径、原子写入、校验、消费与撤销。
- `.claude/hooks/confirm-release-action.sh`：标准入口放行、绕过硬拦、MCP 凭证 Pre/Post 生命周期。
- `.claude/settings.json` / `.codex/hooks.json`：统一挂载 PreToolUse 与 PostToolUse。

## 取代关系

本 ADR 不改变 ADR-0010 的本地集成区边界，也不改变 ADR-0011 的“成功后消费”原则；它取代两者及活跃文档中关于交互确认、Codex ASK 转硬停和 Codex 不支持 PostToolUse 的旧说明。
