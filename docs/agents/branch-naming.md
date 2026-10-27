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

**不单列**：`refactor/`（归 `feature/` 或 `fix/`）、`ci/build/perf/test`（归 `chore/` 或 `feature/`）。

## 环境分支（dev / test / release）

三条长期存在的环境分支，**不受工单命名规范约束**，不带前缀、不带中文简述：

| 分支 | 环境 | 说明 |
|---|---|---|
| `dev` | 开发环境 | 日常联调 |
| `test` | 测试环境 | 提测验收 |
| `release` | 生产环境 | 生产版本 |

### 规则

- **不受白名单约束**：`dev` / `test` / `release` 是固定环境名，不套用五前缀，也不要求中文简述。
- **任务分支固定从 `origin/master` 拉**：工单改动在 `feature|fix|hotfix|docs|chore` 分支上完成，命名规范不变；开工时用 `--target-branch` 声明这条任务之后要合入 `master` 还是 `dev`。
- **PR 必须显式指定目标**：首次发布入口 `publish-review-package.sh --create-pr` 必须带 `--target-branch`，不传直接拒绝。任务分支只允许 `master` 或 `dev`（兼容 `release/*` 批次）；`test` / `release` 由发布入口直接拒绝，只接受环境分支晋级 PR。
- **工具链与平台改动直接投 `master`**：改的是所有人共用的脚本、hook 或规范时，`--target-branch master`；合入 master 后，之后从 master 拉起的所有新分支自动继承。
- **只许合入，禁直推**：`master` / `dev` / `test` / `release` 四条同受保护，`block-push-to-master.sh` 拒绝本地直接 push；改动只能经 PR 合并（仅 `merge` 方法）。
- **裸 `release` 与 `release/` 前缀互斥**：Git 不允许 `refs/heads/release` 与 `refs/heads/release/*` 并存。启用裸 `release` 前必须先清空全部 `release/*` 批次分支。

### 晋级顺序

任务分支只发 `dev`，之后由环境分支逐级晋级，**每一级都只能用下一级作为 source**：

```
master ──拉分支──> feature/xxx ──PR──> dev ──PR──> test ──PR──> release
                      (起点)        (开发环境)   (提测)      (待生产)
                                     └─ source=dev ─┘  └─ source=test ─┘
```

- 开工时用 `--target-branch` 声明目标是 `master` 还是 `dev`，二级以下不由任务分支发起。
- **来源写死**：`test` 只接受 source 为 `dev` 的 PR，`release` 只接受 source 为 `test` 的 PR。Agent 通道由 `confirm-release-action.sh` 硬校验，工单分支、`master` 或跳级 `dev → release` 一律拦截。
- 任务分支发 `dev` 前按该目标重跑 `node scripts/verify-change-scope.mjs run --stage pr --target-branch dev`，凭证不跨目标复用；`dev → test`、`test → release` 的晋级 PR 在 Gitee 发起，不经过工单发布入口。
- **不直接合入环境分支**：`master` 不合入任何环境分支，环境分支之间也不由 master 补提交，只按 `dev` → `test` → `release` 晋级。
- `release` 发版后由人把 `release` 合回 `master`，下一轮从新的 master 拉分支。

工具链判定统一在 `scripts/lib/task_metadata.py`：`ENVIRONMENT_BRANCHES` / `MAIN_BRANCHES` 定义合法分支名，`TASK_BRANCH_TARGETS` 限定任务分支可发的目标。开工入口、PR 发布入口、PR Hook、直推 Hook 与验证凭证共用同一份常量。`release/*` 批次命名保留兼容、不再新建。切换过程见 [ADR-0133](../adr/0133-environment-branches.md)。

## release 分支（发布批次，仅兼容）

发布分支不建 worktree、不挂工单，走独立入口 `scripts/manage-release-branch.sh`。命名：

```
release/YYYY.MM.DD            # 纯日期
release/YYYY.MM.DD_<中文描述> # 日期 + 中文描述（6–15 字）
```

### 实例

```
✅ release/2026.09.09                （纯日期批次）
✅ release/2026.09.09_资产库优化批次   （日期 + 7 字中文描述）
✅ release/2026.09.09_资产库优化批次_2 （同日第二批，入口自动加序号）

❌ release/prod                      （无日期，历史遗留命名，不再新建）
❌ release/2026.9.9                  （日期必须零填充 YYYY.MM.DD）
❌ release/2026.09.09_短             （描述不足 6 字）
❌ release/2026.09.09_hotfix batch   （描述禁空格且须含中文）
```

### 规则

- **日期** = 创建日期（发布日期，`YYYY.MM.DD`，零填充）。
- **描述**：须含中文，6–15 字，禁空格 / 下划线 / 连字符 / 斜杠（与任务分支简述同规）；可省（纯日期批次）。
- **同日多次发布**：同名已存在时入口自动追加序号 `_2` / `_3`。
- **唯一管理入口**：`scripts/manage-release-branch.sh` 的 `list/current/create/activate`；`create/activate` 需发布负责人授权，旧活动批次未收口时拒绝换期。发布后清理走 `scripts/cleanup-release-branch.sh`。
- **校验**：与任务分支同一权威校验器（`scripts/start-task-worktree.py --validate-branch`，pre-push 复用），不合规命名首次 push 即被拒。
- `release/prod` 等历史遗留 ASCII 分支不迁移，只收尾不新建。
- 本命名体系逐步退役，由裸 `release` 环境分支取代；退役顺序见 [ADR-0133](../adr/0133-environment-branches.md)。

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
scripts/start-task-worktree.sh --type fix --issue IK094T --summary 修复工作树写入护栏 --target-branch dev

# 无工单必须明确声明
scripts/start-task-worktree.sh --type chore --no-issue --summary 完善工作树启动流程 --target-branch master

# Windows PowerShell / CMD
py -3 scripts/start-task-worktree.py --type fix --issue IK094T --summary 修复工作树写入护栏 --target-branch dev
```

Agent 从当前发布线工作树调用入口，不直接拼接完整分支名或 Work Tree 目录名。`--target-branch` 必填，只能取 `master`、`dev` 或 `release/<批次>`；`test` / `release` 直接拒绝。起点固定取 `origin/master`。`hotfix` 前缀本身不授予生产修复权限。

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

- **合入 `dev` 后清理本地任务区**：在 task worktree 运行 `scripts/cleanup-task-worktree.sh`，入口核对任务 HEAD 已进入元数据记录的远端目标。之后的 `dev → test`、`test → release` 晋级 PR 由人在 Gitee 发起，不依赖任务区。
- **远端源分支保留**：本地清理入口只删除 task worktree 与本地分支。远端源分支由负责人另行决定去向。
- **废弃分支**（开了不提 PR）：作者自删，不留 stale。
- **不设保留期**：代码历史在 git log + PR 记录里，删分支不丢历史。
- 紧急生产 hotfix 另需负责人授权；日常开工入口固定从 `origin/master` 拉分支，不会因任务类型自动改变起点。

## 保护分支

`master`（`main` 作别名防御，非独立分支）、`dev`、`test`、`release` 四条分支同受保护。三禁：

- 禁直推 / 禁删除（`block-push-to-master.sh` 拦 Agent 通道；`.githooks/pre-push` 拦本机终端，含 `git push origin :dev` 与 `--delete`）
- 禁 force-push（`block-dangerous-git.sh` 拦 `--force` / `-f`；`--force-with-lease` 只放开工单分支）
- 禁删除（本地 `block-dangerous-git.sh` 拦 `branch -D`）

所有进保护分支的改动走 分支 → PR → Gitee 服务端合并，合并方法**只用 `merge`**（`merge-method-check.sh` 全局拦截 `squash` / `rebase`）。详见 [ADR-0003](../adr/0003-no-direct-push-to-master.md) 与 [ADR-0133](../adr/0133-environment-branches.md)。

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
| `scripts/block-dangerous-git.sh` | 非工单分支的 `--force-with-lease` | `feature/* fix/* hotfix/* docs/* chore/*`（release/* 与环境分支是共享基线，禁强推） |
| `.claude/hooks/block-push-to-master.sh` | Agent 直推 `master/main/dev/test/release` | 只放行工单分支与普通推送 |
| `scripts/start-task-worktree.py` | 创建前拒绝不合规命名与不可达目标 | 工单分支五前缀 + 中文简述；`release/YYYY.MM.DD[_描述][_N]`（描述含中文 6–15 字）；任务目标只允许 `master`/`dev`/`release/*` |
| `.githooks/pre-push` | 拒绝直推或删除 `master/main/dev/test/release`；拒绝首次 push 新建不合规分支名；普通任务分支日常 push 不检查是否落后 | 复用 Python 校验器（含 release 命名与环境分支） |
| `.claude/hooks/confirm-release-action.sh` | PR 目标不在 `master` / `dev` / `test` / `release` / `release/*`；`test` 的 source 不是 `dev`、`release` 的 source 不是 `test`；`manage-release-branch.sh create` 缺授权 | `dev → test`、`test → release` 晋级 PR 放行；`list`/`current` 只读放行；`create`/`activate` 须 `--user-authorized` |
| `scripts/publish-review-package.sh` | 首次发布缺 `--target-branch`，或目标是 `test` / `release` | 必须显式指定 `master`/`dev`（或兼容 `release/*`） |

分支名不合规会在创建和首次 push 两个节点被拒绝。策略生效前已经存在于 `origin` 的 ASCII 分支仅允许继续收尾，不要求迁移；不得据此创建新的 ASCII 分支。排障见入口错误信息或 hook 脚本注释。
