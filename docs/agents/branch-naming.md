# 分支命名规范

> 本仓库分支命名的**单一权威源**。前缀白名单由 hook 强制（`scripts/block-dangerous-git.sh` + `.githooks/pre-push`）；本文与 hook **同源维护**——改前缀必须同步改 hook。
> 决策背景见 [ADR-0004](../adr/0004-branch-naming.md)。

## 两条铁律

1. **强制白名单**：分支名必须以下列前缀开头，否则 `--force-with-lease` 被拦、落后于 `origin/master` 时 push 被拦。
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

- **合并即删源分支**：Gitee 合并界面勾「删除源分支」，或 MCP `merge_enterprise_pull` 后 `git push origin --delete <分支>`。
- **本地清理**：`git branch -d <分支>` + `git fetch --prune`。
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
| `.githooks/pre-push` | 工单分支落后 `origin/master` 时的 push | 同上 |

分支名不在白名单 → rebase 后强推被拦、落后 push 被拦。排障见 hook 脚本注释或项目 README。
