# Blue-Whale-AI

<!-- webhook 联动测试注释 -->

## MCP 工具配置

本仓库使用两个 MCP 工具。`.mcp.json` 被 `.gitignore` 忽略（含密钥 + 个人路径），团队成员各自配置本地副本。决策见 [ADR-0012](docs/adr/0012-team-mcp-sharing-strategy.md)，上游决策见 [ADR-0003](docs/adr/0003-no-direct-push-to-master.md) §5。

### codebase-memory-mcp（CBM）

代码理解工具（结构查询 / 调用链 / 架构全景）。配置在**用户级**（`~/.claude.json`），二进制 + server 注册各成员自行安装。

完整 onboarding（安装 / 配置 / 重启 / 建索引 / worktree 独立索引 / 降级路径）见 [`docs/agents/code-intelligence.md`](docs/agents/code-intelligence.md)「团队 onboarding」章节。

### gitee-ent

Gitee 企业版 Issue / PR 操作工具。配置在**项目级** `.mcp.json`（项目根，gitignored，各成员建本地副本）：

```json
{
  "mcpServers": {
    "gitee-ent": {
      "command": "npx",
      "args": ["-y", "@gitee/mcp-gitee-ent@latest"],
      "env": {
        "GITEE_ENT_API_BASE": "https://api.gitee.com/enterprises",
        "GITEE_ENT_MCP_ACCESS_TOKEN": "<your-token>"
      }
    }
  }
}
```

- `GITEE_ENT_API_BASE`：公开 API 地址，照填。
- `GITEE_ENT_MCP_ACCESS_TOKEN`：**密钥**。获取流程待补（见 [ADR-0012](docs/adr/0012-team-mcp-sharing-strategy.md) §决策 4 登记的缺口）。
