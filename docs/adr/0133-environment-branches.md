# ADR-0133：dev / test / release 三条环境分支

- 状态：已采纳
- 日期：2026-10-26

## 背景

发布流程需要三条长期环境分支：`dev` 对应开发环境，`test` 对应测试环境，`release` 对应生产环境。现状是每期一条 `release/YYYY.MM.DD` 批次分支，任务从当期批次拉出、PR 合回批次、验证后合 `master`。批次分支是一次性、可多条并存的；环境分支是长期、唯一的。两套模型不能同时工作。

`release` 裸名与 `release/*` 前缀在 Git 引用层互斥：实测在已有 `refs/heads/release/2026.09.29` 的仓库里执行 `git update-ref refs/heads/release` 返回 `cannot lock ref`。远端现存四条 `release/*`，裸 `release` 必须先清空该前缀才能建立。

## 决策

1. **环境分支不受工单命名规范约束**。`dev` / `test` / `release` 是固定环境名，不套五前缀，不要求中文简述。
2. **任务分支仍从 `master` 拉**，命名规范不变（`feature|fix|hotfix|docs|chore` 五前缀 + 中文简述）。
3. **PR 显式指定目标环境**：发 PR 时指定合入 `dev`、`test` 或 `release`。
4. **两期落地**。本期只改文档，不改工具链；`release/*` 继续作为活动发布线。

## 落地顺序

### 一期（本 ADR 对应改动）

- `docs/agents/branch-naming.md` 新增「环境分支」章节，声明三个名字及其对应环境。
- 不改任何脚本、hook 或测试。理由：`release/` 是整个发布线工具链的锚点，涉及发布线同步（`scripts/lib/release_line_sync.py`）、状态机（`scripts/lib/release-line-state.py`）、PR 发布入口（`scripts/publish-review-package.sh`）、`pre-push` 与 130+ 处测试断言。切换工具链不能与规范变更同一 PR。

### 二期（需单独立项）

1. `main` 检出下运行 `git worktree add ../blue-whale-worktrees/release-2026.09.29 release/2026.09.29` 建立单独发布线工作树。裸 `release` 与 `release/2026.09.29` 互斥，两者不能在同一检出目录来回切。
2. 建 `test` 并从 `master` 推送；`dev` 补上游。
3. 任务 PR 的目标分支从 `release/*` 改为环境分支名，任务元数据的 `target_branch` 同步。
4. 改 `release_line_sync.py` 的 `startswith("release/")` 校验、`release-line-state.py` 的批次分类逻辑、`publish-review-package.sh` 的目标校验。
5. 改 `pre-push`、`block-dangerous-git.sh`、`pretool.py` 的 `WORK_BRANCH_PREFIXES`，让三个环境名在首次推送时放行。
6. 全部 `release/*` 退役并删除远端引用后，再推送裸 `release`。

第 5 步必须先于第 6 步：`pre-push` 对首次推送的新分支强制执行 `--validate-branch`，环境名放行前推不上去。

## 后果

- **裸 `release` 已成为活动发布线**：共享状态 `chore/发布线状态记录` 的 `active` 指向 `release`，六条 `release/*` 批次分支全部转入 `legacy`。裸 `release` 一旦建立，`release/*` 永久不可复建。
- **`dev` 与 `master` 当前同 SHA**：`dev` 尚无上游，首次合入时确定其同步方向。
- **保护层级只在客户端**：`master` / `dev` / `test` / `release` 的直推、强推均由本地 hook 拦截；Gitee 服务端分支保护是否配置，工具链无法验证，需人工在仓库设置中核对。

## 三期补充（2026-10-26）

发布线状态机在批次分支删除后卡死：`classify_releases()` 发现 `active` 不在远端即抛错，而 `activate` 路径同样经过该函数，形成无法自愈的死锁。已一次性改写共享状态 ref 修复（`81f3fedb` → `401dadee`），并把保护规则补齐：

| 改动 | 内容 |
|---|---|
| `pretool.py` | 新增 `ENVIRONMENT_BRANCHES` / `PROTECTED_BRANCHES` / `target-branch` 模式；`protected-push-target` 与 `release-push-target` 覆盖环境分支 |
| `block-push-to-master.sh` | 直推拦截扩到 `dev` / `test` / `release` |
| `confirm-release-action.sh` | PR 目标白名单改走 `target-branch` 谓词，与 `task_metadata.is_target_branch` 语义一致 |
| `publish-review-package.sh` | 首次发布必须显式传 `--target-branch`，不再从任务元数据静默回退 |
| `branch-naming.md` | 「保护分支」扩为四条，「切换状态」改为已完成 |

## 四期补充（2026-10-27）：晋级链路收紧

任务分支不再是晋级源头，改由环境分支逐级晋级：

```
任务分支 ──PR──> dev ──PR(source=dev)──> test ──PR(source=test)──> release
```

| 改动 | 内容 |
|---|---|
| `task_metadata.py` | 新增 `TASK_BRANCH_TARGETS = ("dev",)`；`ENVIRONMENT_BRANCHES` / `MAIN_BRANCHES` 不变，`is_target_branch` 仍用于校验分支名合法性 |
| `confirm-release-action.sh` | 硬校验晋级来源：`test` 只接受 source `dev`，`release` 只接受 source `test`；命中时跳过发布标记校验（晋级 PR 不由工单发布入口发起） |
| `publish-review-package.sh` | 任务分支目标限定 `master` / `dev`（兼容 `release/<批次>`），`test` / `release` 直接拒绝 |
| `start-task-worktree.py` | `--target-branch` 只接受 `master` / `dev`（兼容 `release/<批次>`），`test` / `release` 在建区阶段即拒绝 |
| `dev` 行为 | 保持原逻辑：仍只收 PR，禁直推，禁删除 |

代价：任务 HEAD 进入 `dev` 后，若 `test` / `release` 后续需要再改，必须新开任务分支重新走一遍 `dev`，不能用原任务分支补提交。这一步换来的是来源可校验、不会出现工单分支直插 `test` / `release`。
