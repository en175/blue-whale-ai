## 路由表：按场景 Must Read 对应规则文件

> **渐进式加载**：本表 + 下方 ID 兜底常量 + 最高红线摘要常驻上下文；规则全文按需读。碰对应场景前 **Must Read** 指向的文件，不凭记忆操作。加载策略与分层决策见 [ADR-0044](docs/adr/0044-rules-progressive-loading.md)。

| 场景（碰这类操作前 Must Read） | 规则文件（加载方式） |
| --- | --- |
| 启动/调试本地服务（起环境、连数据库） | `.claude/skills/start-local-services/SKILL.md`（链接至 `.agents/skills`）+ `docs/adr/0064-testsite-db-access-governance.md`（红线：测试站连接串不落任何入库文件，只走进程环境变量注入；接管 3000/3100 前先跑 `bash .claude/skills/start-local-services/scripts/check-local-services.sh` 核对端口背后的代码目录与数据库指向） |
| 代码理解（查结构 / 调用链 / 架构） | `agent-rules/code-discovery.md`（首次只读探索即生效；结构查询先 CBM，worktree 切换校验索引） |
| 判断产品实现技术栈 / Python 工具是否需要处置 | [ADR-0068](docs/adr/0068-node-typescript-product-runtime-and-specialized-compute-boundary.md) + [ADR-0070](docs/adr/0070-product-runtime-stack-does-not-govern-engineering-control-plane.md) + [ADR-0074](docs/adr/0074-frontend-backend-separation-nestjs-product-api.md) + [ADR-0084](docs/adr/0084-generation-worker-java-runtime.md)；逐项结论见 [Python 存量处置清单](docs/specs/2026-08-09-ik7fi6-python-inventory-disposition.md) |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `docs/agents/git-workflow.md`（渐进式） |
| Gitee Issue / 任何 `mcp__gitee-ent__*` 调用 | `docs/agents/issue-tracker.md`（渐进式，首次调用前 Must Read） |
| 测试验证（完成/提交/PR/合并前） | `docs/agents/testing-strategy.md`（收口与 PR 阶段均按影响面分层；仅产品影响路径或显式高风险跑全量；同一 HEAD 复用凭证） |
| 前端工作流（碰 `web/` 产品实现：页面、组件、API 客户端、TanStack Query） | `.claude/skills/frontend-delivery/SKILL.md`（缺陷走 `references/bugfix.md`；新服务端状态读写走 `references/request.md`） |
| PR 模板 / Hook 兜底清单 / 低频细节 | `docs/agents/commit-and-review.md` |
| 当前发布线开工、换期和遗留分支清点 | `docs/agents/git-workflow.md` + [ADR-0115](docs/adr/0115-local-release-code-baseline.md) |
| 产品文档/技能资产归位（docs/projects、docs/skills） | `docs/README.md`（渐进式，新建产品文档前读） |

## Gitee ID 兜底常量

本仓日常可直接使用下表 ID。遇到 401 或疑似变更，先按 `docs/agents/issue-tracker.md`「ID 解析约定」核对 token，再用 `list` API 核对 ID；`scripts/gitee-resolve-ids.sh` 可识别 URL 路由 ID：

| ID | 值 | 含义 | 动态查法 |
| --- | --- | --- | --- |
| `enterprise_id` | `16660949` | 杭州玄浮科技 | `list_enterprises` |
| `project_id` | `48854568` | blue-whale-ai 仓库 | `list_enterprise_repositories` |
| `program_id` | `883843` | Blue-Whale-AI 项目 | `list_programs` |

⚠️ URL 里的 `883843` 是 **program_id**（项目路由），**不是** `enterprise_id` / `project_id`——误当后两者传入会触发误导性 401。完整 ID 解析约定见 `docs/agents/issue-tracker.md`。

⚠️ 所有 `mcp__gitee-ent__*` 写操作：未知/错名参数被**静默忽略**——描述误传 `body` 会建成空描述工单（正确参数名 `description`）。写调用后必须回读验证关键字段已生效，细则见 `docs/agents/issue-tracker.md`「操作约定」。

## 最高红线（摘要，细节见 rules 文件）

1. **禁直推 master** — 全走分支 → PR → merge。`hotfix/*` 无特权。
2. **发布须用户授权** — 未经明确授权禁止 push/PR/merge/release。
3. **合并只用 merge** — 禁 squash/rebase。合并不自动删源分支，事后手动清理。
4. **代码相关任务先同步当前发布线** — 包括只读调查、调试与审查。先在当前本地 `release/*` 工作树运行 `scripts/sync-release-line.sh`，核对实际目录的代码索引，再读代码；失败时停止并报告。写入任务随后运行唯一开工入口 `scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <6–15字中文简述>`，进入独立任务 worktree。散文文档与 chore 同路。本地个人配置窄例外见「写入前自检」。
5. **master 只代表生产版本** — 日常 feature/fix/docs/chore 从唯一活动发布线开工，PR target 为任务元数据记录的同一条 `release/*`。批次在 staging 验证后合入 master 并发布。紧急生产 hotfix 须负责人另行授权，不由日常入口自动选择 master。PR 审合前不把任务代码合入 master。细则见 `docs/agents/git-workflow.md`。
6. **Worktree 基于同步后的本地 release** — 入口抓取同名远端 release，保留本地已提交历史；远端领先时快进，分叉无冲突时合并。冲突、远端不可达或未提交文件可能受影响时停止。入口从同步后的精确 SHA 建任务区，并记录目标分支与起点 SHA；验证、发布和清理均读取该记录。
7. **授权无二次弹框** — 只认当前对话中的人类授权；Agent 自动使用 `--user-authorized` 或一次性凭证（提交入口除外：worktree 工单分支 commit 本地可逆，出现即放行），Hook 只纠偏和硬拦，不返回 ASK。
8. **文档驱动、Hook 兜底** — Agent 优先依据本文件及路由规则主动调用标准入口；Hook 只在检测到绕过、缺授权、缺模式或危险 Git 操作时阻断，禁止让 Hook 自动同步、选择策略或推进正常状态机。
9. **同族工单串行、契约先行** — 同一契约章节的基础设施先合入，功能工单再开工；跨进程字段先在契约文档定死后实现。细则见 `docs/agents/git-workflow.md`（路由表 Must Read）。
10. **产品实现技术栈红线** — 只约束直接交付用户能力的产品实现：Web UI 使用 Next.js App Router；浏览器业务 API 由独立 NestJS `backend/` 服务承载（见 ADR-0074）；generation 执行服务为 `server/blue-whale-worker/`（Java 直连 DB 运行时：claim/fencing/终态写入由 Java 权威实现，与 backend 仅经 DB+MQ 交互，金标套件对账——见 ADR-0084 修正二；系批准新建服务，非已退役 `blue_whale_server` 复活）；**计费服务为 `server/blue-whale-billing/`（同为 Java 例外，见 ADR-0114 决策 6：账本是钱路径，必须能被逐行 review，与 worker 同款的防漂移约束）**；其余服务端与 Worker 进程使用 Node.js LTS；共享领域、契约与持久化能力位于跨语言 `contracts/` 契约与 TypeScript packages。除 `worker-java` 与 `billing-svc` 外禁止新增 Java/Python 产品运行时，或恢复已退役的 `blue_whale_server`、`blue_whale_agent_worker`；已迁出独立仓库的 `blue_whale_api`、`blue_whale_pay_web`、`blue_whale_pay_server` 不在本仓维护；专用计算例外按路由表中的 ADR-0068 判断。
11. **工程工具不受产品语言禁令** — Hook、Worktree、Git/PR/发布、Agent 授权与审计等工程协作控制面，以及产品测试、构建/数据库维护等长期工具和一次性脚本，不因产品采用 TypeScript 而必须改写。无关 Python 存量默认不阻塞普通功能工单，也不自动形成迁移任务；分类、触发条件与验收方式按路由表中的 ADR-0070 和处置清单执行。
12. **验证按影响面与阶段分层** — 任务收口与创建/更新 PR 前都由选择器按影响面决定验证层级；PR 前必须运行 `--stage pr` 并通过发布门禁，但普通治理、Hook、Git、worktree、PR 和运维工具改动保持定向验证，只有产品影响路径或显式高风险进入全量。纯文档保持文档验证。同一 HEAD 的有效凭证直接复用，代码、基线或影响面变化后重新验证。细则见 `docs/agents/testing-strategy.md`。

## 任务状态机（摘要，全文见 `docs/agents/issue-tracker.md`）

带 `--issue` 的工单任务，状态随流程自动流转，Agent 主动调 `update_enterprise_issue`，不等人手动改：

| 时机 | 流转 |
| --- | --- |
| worktree 入口成功 | 需求 意向→进行中；任务 待办的→进行中；缺陷 待确认/已确认→修复中 |
| PR 创建成功 | 打 `ready-for-review` 标签 |
| PR 合并成功 | 需求/任务→已完成；缺陷→已修复 + `修复待验证` 标签 |

- **禁设状态**：已验收 / 已拒绝 / 已取消 —— 归人。
- **前置错位**：工单已在进行中或已是终态 → 停止，问人，等指示。
- 变更失败重试一次；仍失败继续主线但汇报置顶标红。`--no-issue` 与只读任务不适用。

## 写入前自检（每次写操作前强制执行）

**摘要是约束声明，自检是执行机制。** 在调用 Edit、Write 或任何会改变 Git 状态的操作前，必须逐项完成以下检查：

1. **确认当前分支** — 读取当前分支；普通可写任务必须位于由当前发布线开工入口创建的结构化中文工单分支，不得在 `master` / `main` / `release/*` 直接写入。
2. **确认 Agent 任务区** — 确认已从当前本地发布线通过开工入口创建并进入独立 task worktree。
3. **确认目标路径** — 对每个写入目标确认其所属 Work Tree；目标路径不得指向 master 或 release 检出区。
4. **确认 Git 写入区域** — 任何会改变 Git 状态的操作只在正确的 Agent 任务区及其工单分支执行。

任一项不满足，立即停止写入，先同步发布线并通过开工入口进入任务 Work Tree。

**本地个人配置例外**：根 `CLAUDE.local.md` 与 `.codex/config.toml` 仅在 `git check-ignore` 明确命中时可在本地 master 修改。Agent 必须保持文件未跟踪、不得输出其中凭证；其他路径，包括散文文档，仍走任务 worktree。

## Agent skills

> mattpocock/skills 工程技能的配置锚点：技能运行时读 `docs/agents/` 下三份配置（issue-tracker / triage-labels / domain），与路由表的工作流规则文件是两套。

### Issue tracker

规则全文见路由表（`docs/agents/issue-tracker.md`，含迁移 runbook）。外部 PR 非请求面。

### Triage labels

五角色全默认名（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（根 `CONTEXT.md` + `docs/adr/`）。见 `docs/agents/domain.md`。
