# release 分支策略 + Hook 瘦身决策

> 日期：2026-07-31 ｜ 关联：[ADR-0063 引入 release 分支线](../adr/0063-release-branch-strategy.md)、[ADR-0003 禁直推 master](../adr/0003-no-direct-push-to-master.md)、[ADR-0010 本地 master 是用户集成区](../adr/0010-local-master-is-user-integration-zone.md)、[ADR-0025 文档直改 master 白名单](../adr/0025-doc-on-master-allowlist.md)

## 1. 背景与核心矛盾

ADR-0063（2026-07-31 Accepted）引入 `release/*` 分支线，取代 ADR-0004「不加 release 分支」的旧决策。首个 `release/prod` 已从 `origin/master`（`67146fe2`）创建，本地与远程均存在。

但 ADR-0063 只更新了「政策层」（CLAUDE.md / rules 的白名单待办），**执行层（hooks + 标准入口脚本）完全没被告知**，形成**分裂脑**：

- **政策说**：release 是发布基线，bugfix 走「分支 → PR → 服务端 merge」合进 `release/*`。
- **执行层说**：PR 只能指向 master（`confirm-release-action.sh:329` 硬拦别的 target），且整套 push/commit/merge/sync 脚本默认终点都是 master。

更深的现实驱动：**团队中存在一位靠 AI 写代码、但不读代码的协作者（领导），与团队共用 master。** 快速迭代中若 master 出问题波及到他，他可能让 AI 直接「修」master，进而影响团队代码。因此需要一个**团队独占、生产部署只从此拉取的隔离基线**。

## 2. 结论

**保留 release/prod。** 它在本场景的存在理由是「隔离」而非单纯「部署锚定」：

- **master = 草原**：团队快速迭代 + 领导的 AI 实验，炸了没关系。
- **release/prod = 冻结区**：只收团队 review 过的 bugfix（走 PR），生产只从此部署。
- 不管 master 被谁搞炸——团队或领导——生产永远停在 `release/prod` 最后一个已知好版本上。

**但 release 的护盾不能只靠本地 hook。** 本地 hook 是**对称**的：对所有人一视同仁，分不清「领导」和「团队」。真正能做「只许团队合、不许领导合」的，只有 **Gitee 服务端分支保护**。这是本地 hook 在架构上永远做不到的事。

## 3. Hook 现状审计

### 3.1 过度拦截（日常卡顿来源，需瘦身）

| 拦截点 | 文件:行 | 问题 |
| --- | --- | --- |
| **任何 `git push` 全拦** | `confirm-release-action.sh:245` | 连「推 WIP 分支到远程备份」都不行，每次推送绑死成「建/更 PR + `--user-authorized`」 |
| **`git commit` 全拦** | `confirm-release-action.sh:254-258` | 必须走 `commit-task-for-review.sh`，本地可逆操作被强制脚本化 |
| **本地 `git merge` 全拦** | `confirm-release-action.sh:260-263` | 必须走 `merge-task-to-local-master.sh --user-authorized` |
| **PR target 必须 master** | `confirm-release-action.sh:329` | 直接与 ADR-0063 打架：建不出指向 `release/*` 的 PR |

根因：这套 hook 的设计姿态是「**假设每个 agent 动作都危险，全部强制走审计入口 + 授权凭证**」——给「不信任的 AI」准备的防御。对领导那种「全靠 AI 不懂」的人合理，**对懂代码、要快速迭代的团队就是纯摩擦**。

### 3.2 反向缺口（release 保护不足）

| 拦截点 | 现状 | release/* 缺口 |
| --- | --- | --- |
| `block-master-edit.sh:91` | 只拦 master 直改 | Agent 能在 `release/prod` 直接 Edit/Write，不经 worktree |
| `block-push-to-master.sh:53` | 只保护 `master\|main` | 能直接 `git push origin release/prod`，绕过 PR |
| `block-dangerous-git.sh:71` | force-with-lease 白名单无 `release/` | 偶尔 rebase release 会被卡（次要） |

**master 受重重保护，release/prod 近乎裸奔**——与它「生产发布基线」的身份严重不匹配。

### 3.3 合理保留（灾难性操作 + 项目硬规则，不动）

- `git reset --hard`、`git clean -f`、裸 `--force` push、`git branch -D`（强删）——灾难性，留。
- 直推 / 直改 master——团队护盾，留。
- squash / rebase 合并——项目硬规则（merge only），留。
- 删分支本身**不是问题**：只拦 `-D`（强删），`-d`（安全删）与 `scripts/cleanup-task-worktree.sh` 均放行。

## 4. 改造方案（两阶段，低风险优先）

### 阶段 1：Gitee 服务端分支保护（真正防火墙，不碰 hook）

唯一不依赖「领导本地装没装 hook」的闸，优先级最高：

- **`release/prod`**：必须 PR 才能合、**合并权限限定团队几个人（排除领导）**、禁止直推。
- **`master`**：必须 PR（是否限团队合视迭代速度诉求而定——保持快则开放自合，求稳则也限团队）。

> 可能需要领导授权 Gitee 管理员权限（他若是企业 owner）。此阶段零代码风险，汇报后最易获批。

### 阶段 2：本地 hook 瘦身（解日常卡顿）

| 改动 | 文件:行 | 效果 |
| --- | --- | --- |
| 放开普通 `git push`（非保护分支） | `confirm-release-action.sh:245` | 直接推 feature 分支，不再每次绑 PR + 授权 |
| 放开 `git commit` | `:254-258` | 直接提交，不再强制走 commit-task 脚本 |
| 放开本地 `git merge` | `:260-263` | 本地合分支自由（保护分支仍由服务端挡） |
| 修 PR target 允许 `release/*` | `:329` | PR 可指向 release，不只 master |
| master 保护**复制给 release** | `block-master-edit.sh` / `block-push-to-master.sh` | release/prod 禁直改/直推，与 master 同级 |
| `release/` 加入分支前缀白名单 | `block-dangerous-git.sh:71` 等 | force-with-lease 等场景不再误卡 release |

> 阶段 2 改 `.claude/`（规则源），**必须走 task worktree**（ADR-0025 例外仅限散文 `docs/**/*.md`，不含 `.claude/`）。入口：`scripts/start-task-worktree.sh --type chore --no-issue --summary release-hook瘦身`。

## 5. matt 技能 / 现有工作流不受影响

「多 agent 多人共享上下文」的前提完全保留：

- `scripts/start-task-worktree.sh` **不变** → worktree 工单分支流程一字不改。
- `publish-review-package.sh` / `commit-task-for-review.sh` / `sync-task-from-origin.sh` / `merge-task-to-local-master.sh` **脚本仍在**，只是从「强制」降为「可选」。
- matt（superpowers）技能调这些脚本照常；**直接 git 命令现在也能用**——反而更顺（以前 matt 技能想 `git commit` 会被 hook 弹回，现在不会）。
- superpowers 整套技能、CLAUDE.md 路由表、issue 状态机均不动。

**瘦身的本质是让 matt 技能少跟 hook 打架，不是拆它的台。**

## 6. 风险与保留项

- **服务端保护是硬依赖**：阶段 1 不上，阶段 2 瘦身会让领导（及所有人）在本地更自由，但失去本地 hook 兜底后若服务端无保护，master/release 将直面误操作。**顺序不能反**。
- **`--user-authorized` 是 agent 自声明**：领导在自己会话里能让 AI 自授权合并自己的 PR。本地 hook 拦不住「谁有权合」，只能拦「走不走 PR」。合并权限控制必须落服务端。
- **一次性凭证流程（合并 PR / 建 release）**：频率低（每 PR / 每发版一次），非日常摩擦源，暂保留作审计；若日后仍嫌重，单独评估松绑。
- **release 维护成本**：release 的 bugfix 必须回合（backport）master，否则两边分叉。需 CI 或人工巡检（ADR-0063 已列待办）。

## 7. 给领导的汇报口径

原则：**①讲风险和速度，不讲技术名词；②强调「你的 AI 也更安全」，不讲「我在防你」；③给一个明确的「需要你做什么」。**

### 可直接发送的措辞

> 老板，最近迭代快，我做了两个调整，目的是**线上更稳、大家更快**：
>
> 1. **加了一条「上线分支」(release)**：日常开发在 master 上随便试、随便改都不怕，因为线上只从 release 拉。这样**不管谁在开发分支上试出新东西，都不会波及线上**——包括您用 AI 做的实验，也都在安全区里，碰不到生产。
> 2. **顺手把一些过度保守的 AI 拦截减掉了**：之前 AI 每次推送代码都被拦着走一堆流程，现在放开了日常操作，**大家迭代更快，matt 那套 AI 工具照常用，完全没受影响**。
>
> 唯一需要您帮忙的：**给我 Gitee 的分支管理权限**（或者您点一下同意），我把上线分支的合并权限设成只限我们几个，确保没人误操作碰坏线上。其他不用您操心。

### 要 / 不要

| ✅ 要这么说 | ❌ 别这么说 |
| --- | --- |
| 「保护线上不受开发影响」 | 「怕你把代码改坏」（等于说人不懂） |
| 「你的 AI 实验在安全区里」 | 「我在限制你的权限」 |
| 「让大家迭代更快」 | 「我要改 hook 配置」（听不懂也不关心） |
| 「matt 工具照常用，不影响」 | （略过不提，他会担心） |

**追问「为什么以前不需要现在需要」的标准回答**：以前代码少、人就我们几个；现在迭代快、AI 也在写，加个保险栓而已——流程没变重，反而轻了。

## 8. 待办

- [ ] **阶段 1**：申请 Gitee 管理权限 → 设 `release/prod`（团队独占合并）+ `master`（必须 PR）服务端保护。
- [ ] **阶段 2**：开 task worktree，按 §4 阶段 2 表改 5 处 hook（含 `:329` 修 PR target、release 保护复制、前缀白名单）。
- [ ] 跑 `scripts/test-hooks.sh` 回归（`block-squash-merge.sh` 等仍由它覆盖）。
- [ ] ADR-0063 自身待办补齐：ADR-0004 标 Superseded、CLAUDE.md / rules 白名单加入 `release/`。
- [ ] 建「镜像版本与部署溯源」ADR（commit tag 绑定规则）——光有分支不够，部署必须绑 commit。
