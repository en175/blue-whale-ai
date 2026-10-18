## 路由表：按场景 Must Read 对应规则文件

碰对应场景前读取指向的规则，不凭记忆操作。常驻原则保留关键约束，详细流程按需加载，分层依据见 [ADR-0044](docs/adr/0044-rules-progressive-loading.md)。

| 场景 | 必读规则 |
| --- | --- |
| 启动/调试本地服务、连接数据库、接管端口 | `.agents/skills/start-local-services/SKILL.md` + `docs/adr/0064-testsite-db-access-governance.md` |
| 代码理解：查结构、调用链、架构；切换 worktree | `agent-rules/code-discovery.md` |
| 产品技术选型、运行时例外、Python 工具处置 | `agent-rules/product-runtime.md` |
| Git 提交、分支、PR、发布、worktree；当前发布线开工、换期、遗留分支清点 | `docs/agents/git-workflow.md` |
| 多工单单 PR、集成分支、并行子任务合回 | `docs/agents/integration-branch-workflow.md` |
| 任何 Gitee MCP 调用、规格发布与拆单 | `docs/agents/issue-tracker.md` |
| 工单开工、恢复、返工、部署确认、提测、生产验证与收口 | `docs/agents/gitee-workflow-agent.md` |
| 测试验证：任务收口、提交审查、创建/更新 PR、合并前 | `docs/agents/testing-strategy.md` |
| Blue-Whale 账号密码登录：浏览器自动化、本地服务确认、测试站直连 | `agent-rules/app-login.md` |
| 前端产品实现：`web/` 页面、组件、API 客户端、TanStack Query | `agent-rules/frontend-web.md` + `.agents/skills/frontend-delivery/SKILL.md`；缺陷读 `references/bugfix.md`，新服务端状态读写读 `references/request.md` |
| PR 模板、Hook 兜底清单 | `docs/agents/commit-and-review.md` |
| 新建产品文档、产品文档/技能资产归位 | `docs/README.md` |

## 常驻原则

1. 本仓库工单与 PR 全部读写仅使用 Gitee MCP；操作前读取 [渠道规则](agent-rules/gitee-mcp-only.md)。
2. 发布须当前对话中的人类明确授权，涵盖 push、PR、merge、release；Agent 自动使用标准入口和授权凭证，已有授权不二次确认。
3. master 代表生产版本，禁止直推；PR 合并只用 merge，合并后按清理入口处理源分支，`hotfix/*` 无特权。
4. 代码相关任务，包括只读调查、调试和审查，先在当前本地发布线运行 `scripts/sync-release-line.sh --json` 并核对该目录索引；失败即停止报告。写入任务再经 `scripts/start-task-worktree.sh` 进入独立任务区，PR 指向任务元数据记录的 release。
5. Agent 按文档主动调用标准入口；Hook 只纠偏或阻断，不返回 ASK，不自动同步、选择策略或推进任务状态。
6. 同一契约章节的基础设施工单先合入目标 release，功能工单再开工；跨进程字段先在契约文档确定。
7. 产品采用 TypeScript、Next.js Web、NestJS API 与 Node.js LTS；已批准的两个 Java 服务和专用计算边界见技术栈规则。工程工具不受产品语言禁令，无关 Python 存量不阻塞功能任务。
8. 收口与发布前按测试策略取得当前有效凭证；带工单任务主动按 Agent 工作流手册核对事件与验收证据后流转。
9. Agent 在编程实施过程中禁止新增普通代码注释；仅保留必要的工具指令和许可证声明。编程或审查前读取 [注释规则](agent-rules/code-comments.md)。

## Gitee ID 兜底常量

本仓日常使用以下 ID；疑似变更或 401 时按 issue-tracker「ID 解析约定」核对。

| ID | 值 | 含义 |
| --- | --- | --- |
| `enterprise_id` | `16660949` | 杭州玄浮科技 |
| `project_id` | `48854568` | blue-whale-ai 仓库 |
| `program_id` | `883843` | Blue-Whale-AI 项目 |

URL 中的 `883843` 是项目路由 `program_id`，不能充当 `enterprise_id` 或 `project_id`。

## 写入前自检

调用 Edit、Write 或任何改变 Git 状态的操作前，逐项核对：

1. 当前分支与工作目录是从当前发布线经开工入口建立的独立任务区及结构化中文工单分支。
2. 每个写入目标所属 Work Tree 都是该任务区，不指向 master、main 或 release 检出区。
3. Git 状态变更仅在该任务区及工单分支执行；任一项不满足，先停止写入并通过同步、开工入口纠正。

本地个人配置窄例外：根 `CLAUDE.local.md` 与 `.codex/config.toml` 仅在 `git check-ignore` 明确命中时可在本地 master 修改；保持未跟踪，不输出凭证。其他路径，包括散文文档，仍走任务区。本地任务 commit 可逆，经 `scripts/commit-task-for-review.sh` 提交，无需发布授权。

## Agent skills

技能配置入口如下，使用对应技能前读取配置。

### Issue tracker

见 `docs/agents/issue-tracker.md`。

### Triage labels

见 `docs/agents/triage-labels.md`。

### Domain docs

见 `docs/agents/domain.md`。
