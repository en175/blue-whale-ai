# 分支命名规范

> 本仓库分支命名的详细规范。团队 Agent 总规则以根目录 `CLAUDE.md` 为权威源；创建与校验逻辑统一由 `scripts/start-task-worktree.py` 提供，`.githooks/pre-push` 复用该校验器。
> 决策背景见 [ADR-0004](../adr/0004-branch-naming.md)。

## 两条铁律

1. **强制白名单**：分支名必须以下列前缀开头，否则入口拒绝创建、`pre-push` 拒绝推送。
2. **前缀英文、标题中文**：前缀是 hook bash glob 匹配的，必须 ASCII；标题部分用中文。

## 前缀白名单（工单分支）

| 前缀 | 用途 |
|---|---|
| `feature/` | 新功能 / 增强 |
| `fix/` | 修 bug |
| `hotfix/` | 生产紧急修复（仍走 PR，无特权） |
| `docs/` | 文档 / 规则文件（`CLAUDE.md` / ADR / `docs/agents/*` / `README.md`） |
| `chore/` | 构建 / 脚本 / 配置 / CI 等杂项 |

**不单列**：`refactor/`（归 `feature/` 或 `fix/`）、`release/`（无发布分支线，`master` 即发布，见 [ADR-0003](../adr/0003-no-direct-push-to-master.md)）、`ci/build/perf/test`（归 `chore/` 或 `feature/`）。

> 前缀粒度是**任务级**（这批改动啥性质），不是提交级。一个 `feature` 分支可含 `feat`+`docs`+`refactor` 多次提交。提交级语义用 [Conventional Commits](commit-and-review.md)（type：`feat`/`fix`/`docs`/`refactor`/`chore`/…）。

## 标题格式

```
<前缀>/<工单号>-<中文简述>     # 有 Gitee issue
<前缀>/<中文简述>              # 无 issue（hotfix 应急 / 纯重构 / 文档）
```

### 规则

- **工单号**：你的 Gitee issue 标识符（字母数字串，非纯数字）。**有则必带**，用 `-` 连简述；无则连 `-` 一起省。
- **简述**：中文，**动宾结构**（做+啥），6–15 字，禁纯名词。
- **分隔符**：仅 `/`（前缀）+ `-`（号-简述）。简述内部**禁**空格 / `_` / `-`。
- **大小写**：工单号保留 Gitee 原样；简述部分混入的英文/拼音用小写。
- **禁**：空格、下划线、纯英文 / 纯拼音标题。

硬校验只判断可稳定自动判断的格式：前缀、工单号、中文字符、长度及非法分隔符。“动宾结构、禁纯名词”由 Agent 在生成简述时自检，不在脚本中猜测中文语义。

## 唯一创建入口

```bash
# macOS / Linux / Git Bash
scripts/start-task-worktree.sh --type fix --issue IK094T --summary 修复工作树写入护栏

# 无工单必须明确声明
scripts/start-task-worktree.sh --type chore --no-issue --summary 完善工作树启动流程

# Windows PowerShell / CMD
py -3 scripts/start-task-worktree.py --type fix --issue IK094T --summary 修复工作树写入护栏
```

Agent 不直接拼接完整分支名或 Work Tree 目录名；入口根据结构化参数生成并验证。

### 实例

```
✅ feature/ABC123-新增对话历史导出   （ABC123 = 你的 Gitee issue 标识符）
✅ fix/ABC123-修复登录态丢失
✅ hotfix/接口502应急回滚            （无工单号，应急）
✅ feature/重构权限校验链路           （无工单号）
✅ docs/补全分支命名规范             （无工单号）
✅ chore/升级npm依赖                （无工单号）

❌ feature/登录              （纯名词，无动作）
❌ feature/add login         （空格）
❌ feature/Add_Login         （下划线；工单号外的英文应小写）
❌ bugfix/ABC123-xxx         （前缀不在白名单）
❌ feature/fix-login-bug     （英文标题）
```

## 生命周期

- **合并即删源分支**：Gitee 合并界面勾「删除源分支」，或 PR 合并后在 task worktree 运行 `scripts/cleanup-task-worktree.sh`。
- **本地清理**：由 `scripts/cleanup-task-worktree.sh` 删除 task worktree、本地分支并 `git fetch --prune`。
- **废弃分支**（开了不提 PR）：作者自删，不留 stale。
- **不设保留期**：代码历史在 git log + PR 记录里，删分支不丢历史。
- `hotfix` 同理：一次性，合并即删。

## 保护分支

`{master}`（`main` 作别名防御，非独立分支）。三禁：

- 禁直推（`pre-push` 拦 `refs/heads/master`）
- 禁 force-push（`block-dangerous-git.sh` 拦）
- 禁删除（`block-dangerous-git.sh` 拦 `branch -D`）

所有进 `master` 的改动走 分支 → PR → Gitee 服务端合并。详见 [ADR-0003](../adr/0003-no-direct-push-to-master.md)。

## feat ≠ feature（刻意）

| 场景 | 词 | 来源 |
|---|---|---|
| commit type | `feat` | Conventional Commits 标准（规范缩写） |
| 分支前缀 | `feature` | 业界分支命名惯例（`feat/` 罕见） |

两者**刻意不统一**，各自遵各自规范。不要「统一」成 `feat` 分支或 `feature` 提交。

## 中文分支名风险（已接受）

git 原生支持 UTF-8 分支名，Gitee 支持。国际惯例分支名走 ASCII（理由：URL 编码 / shell 转义 / 跨平台兼容）。本仓库决策：**全团队用 Gitee，不涉 GitHub / 海外 CI**，接受中文标题（见 [ADR-0004](../adr/0004-branch-naming.md)）。hook 已实测 UTF-8 glob 兼容。

## 强制点（hook）

| hook | 拦什么 | 白名单 |
|---|---|---|
| `scripts/block-dangerous-git.sh` | 非工单分支的 `--force-with-lease` | `feature/* fix/* hotfix/* docs/* chore/*` |
| `scripts/start-task-worktree.py` | 创建前拒绝不合规命名 | `feature/* fix/* hotfix/* docs/* chore/*` + 中文简述 |
| `.githooks/pre-push` | 拒绝直推 `master/main`；拒绝首次 push 新建不合规分支名；普通任务分支日常 push 不检查是否落后 | 复用 Python 校验器 |

分支名不合规会在创建和首次 push 两个节点被拒绝。策略生效前已经存在于 `origin` 的 ASCII 分支仅允许继续收尾，不要求迁移；不得据此创建新的 ASCII 分支。排障见入口错误信息或 hook 脚本注释。
