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

- **一期不改代码**：规范与现实存在过渡期，`branch-naming.md` 的「切换状态」段落显式说明。
- **二期前 `release/*` 仍是唯一可用发布线**：新任务继续从 `release/2026.09.29` 开工。
- **裸 `release` 一旦建立，`release/*` 永久不可复建**：工具链若需保留批次能力，应在二期一并决定是否放弃。
- **`dev` 与 `master` 当前同 SHA**：`dev` 尚无上游，二期推送时确定其同步方向。
