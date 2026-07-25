# .mcp.json 密钥抽离与部分进仓可行性评估

> 调研：把 `.mcp.json` 里的密钥抽离到 `.env` / 环境变量，进而解禁 `.mcp.json` 部分进仓的可行性。**只评估不实施。**
> 触发工单：IK006M。配套决策见 [ADR-0012](../adr/0012-team-mcp-sharing-strategy.md)。

## 结论（TL;DR）

抽离 gitee-ent token 技术可行但收益有限；`.mcp.json` **整体进仓不可行**（CBM 个人绝对路径 = 第二独立阻断根因）；本期**不建议实施**，优先补 onboarding 文档 + `.gitignore` 加固。

## 现状

- `.mcp.json` 含 2 字段：`GITEE_ENT_API_BASE`（公开 API 地址，非密钥）+ `GITEE_ENT_MCP_ACCESS_TOKEN`（唯一密钥，明文）。
- `.mcp.json` 未被 git 追踪，token **从未进入 git 历史**（全历史 grep = 0 命中）——token 仅存于本地工作副本。
- CBM 在用户级 `~/.claude.json` 顶层 `mcpServers`，command 为个人本机绝对路径 `/Users/kimjohn/.local/bin/...`。
- `.gitignore` 第 9 行 ignore `.mcp.json`，但**未显式列 `.env` / `*.key` / `*.pem`**（仅靠 `docs/agents/commit-and-review.md` + `docs/agents/git-workflow.md` 文档纪律约束）。

## (a) 密钥抽到 .env / 环境变量

**方案 A：`.mcp.json` 内 env 值改 `${GITEE_ENT_MCP_ACCESS_TOKEN}` 占位**
- 技术不确定点：Claude Code 的 `.mcp.json` 是否支持环境变量插值。疑为字面量解析（值原样传入），**需实测验证**。若不支持，方案 A 失效。
- 若支持：token 从 `.mcp.json` 移到 shell 环境变量，`.mcp.json` 不再含明文密钥。

**方案 B：启动前 wrapper 脚本从 `.env` 生成 `.mcp.json`**
- 进仓模板 `.mcp.json.example`（占位）+ 本地 `.env`（含 token），wrapper 在启动 Claude Code 前用 `envsubst` 之类生成真实 `.mcp.json`。
- 引入额外构建步骤和故障面（wrapper 依赖、生成时机、与 Claude Code 启动顺序）。

两方案均需：新增 `.env.example`（占位模板，进仓）+ `.gitignore` 显式加 `.env`（目前未列，需加固）。

## (b) 解禁后 `.mcp.json` 部分进仓可行性

- **模板化路径**：进仓 `.mcp.json.example`（占位，`${VAR}` 或 `<your-token>`），真实 `.mcp.json` 仍 gitignore，成员各自从模板复制 + 填 token。
- **仅 gitee-ent 非密钥配置**（command / args / `GITEE_ENT_API_BASE`）可进模板。
- **CBM 配置无法进模板**：command = 个人本机绝对路径，每人不同，进模板无意义。

## (c) 成本 / 收益 / 安全风险

| 维度 | 抽离 + 模板化 | 维持现状 |
|---|---|---|
| 成本 | env 插值实测 / wrapper 维护 + `.env.example` 维护 + onboarding 文档改写 | 零 |
| 收益 | 新成员有 `.mcp.json.example` 配置模板参考 | 靠根 README + `code-intelligence.md` 文档指引 |
| 安全 | token 不落工作副本明文（但仍在 `.env` / 环境变量） | token 仅存本地 `.mcp.json`，未进仓 |
| 风险 | env 插值不确定（方案 A 可能失效）；wrapper 增故障面 | token 明文存本地，但未进 git 历史，风险可控 |

## (d) 是否建议实施

**不建议本期实施**。理由：

1. token 从未进 git 历史，当前安全姿态可接受；
2. 即便抽离 gitee-ent token，CBM 的用户级绝对路径（`/Users/kimjohn/.local/bin/...`）仍是 `.mcp.json` 不能整体进仓的**第二独立根因**（第一是 gitee-ent 明文 token）——「解禁」最多做到 gitee-ent 非密钥配置进仓模板化，CBM 配置永远只能用户级，这是「整体进仓」路线不可行的根本原因；
3. 更高优先级 = 补 gitee-ent onboarding（根 README 的 token 获取流程）+ `.gitignore` 显式列 `.env` / `*.key` / `*.pem`（把文档纪律升级为机制兜底）。

## 安全提醒（非本 issue 实施项，仅登记）

`.mcp.json` 当前 token 以明文存在于工作副本。虽未进 git 历史，但本 issue 探索过程中 token 值曾在工单描述 / ADR 草稿中被引用。建议 maintainer 评估是否轮换该 `GITEE_ENT_MCP_ACCESS_TOKEN`。轮换属 maintainer 操作面，不在本 issue 实施范围。
