# 提交与审查规范（细节）

> 本文档是根 `CLAUDE.md`「提交与审查」一节的**下沉细节**。命中以下情况时查本文：
> - 改代码 / 提交前（禁碰清单、commit 规范、禁提交清单）
> - 开 PR（PR 模板）
>
> 高频硬约束（禁碰生成物、禁擅改依赖、conventional commits）已在根 `CLAUDE.md` 原文，本文不重复。
> 防御哲学：**规范前置 → Hook 兜底**。AI 先按规范做对；Hook 仅在 AI 没按规范做时拦。

---

## Commit 规范（Conventional Commits）

格式：`<type>: <描述>`，或 `<type>(<scope>): <描述>`。

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 文档 |
| `refactor` | 重构（不改外部行为） |
| `chore` | 构建/工具/配置杂项 |
| `style` | 格式（不改逻辑） |
| `test` | 测试 |
| `perf` | 性能 |
| `build` | 构建系统/依赖 |
| `ci` | CI 配置 |
| `revert` | 回滚 |

一次提交只干一件事，别混装。

---

## 禁提交清单（hook 会挡）

- **生成物**：`graphify-out/`、`dist*`、`.next/`（前端构建产物）、`__pycache__/`、`*.pyc`、`.pytest_cache/`（后端 Python 缓存）
- **个人本机配置**：`.claude/settings.local.json`（`.gitignore` 忽略；其余 `.claude/` 进仓共享，见根 `CLAUDE.md`）
- **密钥凭证**：`.env`、`*.key`、`*.pem`、含明文密码的配置文件（敏感配置走环境变量，不进仓）

---

## 发布授权与审查门槛

Agent 开发完成后的默认终点是**本地实现 + 验证 + 提交 + 报告待审查**。未经用户明确授权，Agent 禁止执行发布动作：

- `git push`
- 创建 PR
- 合并 PR
- 创建 release
- 删除远程源分支

用户授权使用自然语言即可，不要求固定口令；但必须明确包含发布/推送/开 PR/合并意图。“继续”“可以”“你处理吧”“完成后走流程”这类泛化许可不算发布授权。

**发布审查包**一次授权覆盖“推送当前工单分支 + 创建指向 `master` 的 draft PR”。PR 创建后，Agent 必须停下来交给开发者审查；该授权不覆盖合并。

发布审查包必须使用唯一入口：

```bash
scripts/publish-review-package.sh --user-authorized
```

该入口负责推送当前工单分支；远程分支已存在时会用 `--force-with-lease` 安全更新。Hook 会在入口处要求一次用户确认。禁止直接执行 `git push` 绕过入口；直接 `git push` 会被 Hook 硬拦。脚本成功后会写入短期发布标记，Agent 随后创建 `target_branch=master` 且 `draft=true` 的 Gitee PR；PR Hook 会校验并消费该标记，不再二次确认。没有发布标记、标记过期、分支不匹配、缺 `source_branch` / `target_branch` 都会被拦截。

Codex 项目 hook 通过 `.codex/hooks/run-claude-pretool.sh` 复用 Claude hook；Codex PreToolUse 不支持 `permissionDecision=ask`，所以标准发布入口在 Codex 中会被转换为硬停，避免失败放行。Codex 中的发布动作需要用户手动执行，或切到支持确认弹窗的 Claude Code 环境执行。

**合并 PR**必须另获授权。低风险 PR 可在用户明确授权后由 Agent 用 Gitee MCP 合并；高风险 PR 禁 AI 合并，必须人手动合并。

---

## 合并方法 = merge（非 squash/rebase）

PR 合并用 **merge**，**禁用 squash / rebase**。

**为什么**：squash/rebase 合并改写 commit sha，本地 `git branch -d` 会误判「未合并」（原 sha 不在 master 历史）；叠加 `block-dangerous-git.sh` 拦 `git branch -D` → AI 无法清理本地分支（死锁，见 [ADR-0006](../adr/0006-sync-mechanism-auto-block.md)）。merge 保留原 commit sha，`-d` 正常工作。

**实证**：master 历史 PR 全为 2-parent merge commit，从无 squash。

**约束**：

- AI 用 Gitee MCP `merge_enterprise_pull` 时必须先获得用户合并授权，并使用 `merge_method=merge`（或不传，Gitee 默认 merge）。传 `squash`/`rebase` 会被 `.claude/hooks/block-squash-merge.sh`（PreToolUse）拦（`exit 2`）。
- 人在 Gitee 网页手动合并同样选 **merge**——hook 拦不到服务端人操作，靠自觉 + 本文档约束。
- 合并即删源分支：**MCP `merge_enterprise_pull` 无 `prune_source_branch` 参数、Gitee merge 默认也不删**（踩坑见 [`hooks/README.md`](hooks/README.md)）。PR 合并后，Agent 回到 task worktree 运行 `scripts/cleanup-task-worktree.sh` 清理远程源分支、本地分支和 worktree；人在 Gitee 界面可勾「删除源分支」。

---

## PR 模板

开 PR 前必须先获得用户发布审查包授权。PR 默认创建为 **draft**，描述按此填好（AI 填，人审）。模板文件：`.gitee/PULL_REQUEST_TEMPLATE.md`（Gitee 自动加载）。

```markdown
## 对应开发分支
<!-- 源分支 → 目标分支 + 关联工单号。AI 填时自检分支是否正确。【硬必填】 -->
________ → master
工单：#________（无则填"无"）

## 改动类型
<!-- feat / fix / refactor / docs / chore。【硬必填】 -->
________

## 实现范围
<!-- 目标 + 边界 + 具体改了啥。【硬必填】 -->
________

## 关键文件
<!-- 核心改动文件路径，每行一个。【硬必填】 -->
- ________
- ________

## 设计决策
<!-- 为啥这么做 + 考虑过的替代方案。trivial 改动填「无：<理由>」，裸「无」会被打回 -->
________

## 业务规则
<!-- 涉及的业务约束：权限/数据约束/AI 调用约束。纯技术改动填「无：<理由>」 -->
________

## 风险等级（必填）
<!-- 低=局部改动；中=影响交互/数据流；高=影响核心逻辑/鉴权/数据完整性 -->
- [ ] 低风险（用户授权后可由 Agent 合并）
- [ ] 中风险（建议互审）
- [ ] 高风险（须人审，禁 AI 合并）

## 已知风险
<!-- 已知未解决的问题/潜在影响。无则填「无：<理由>」 -->
________

## 测试结果
<!-- 跑了啥自测 + 覆盖范围（lint/单测/手测）。【硬必填】 -->
________

## 相关测试用例
<!-- 关键用例：边界值/等价类/异常路径，每行一个。无则填「无：<理由>」 -->
- ________
- ________

## 边界条件审查重点
<!-- 请审查者重点盯的代码边界（null/0/负数/并发/权限）。无则填「无：<理由>」。审查者须逐条核对，不是摆设 -->
________

## 未完成事项
<!-- TODO / 后续 follow-up。无则填「无：<理由>」 -->
________

## 前后端联动自检（改了后端 API 路由时必填）
- 后端动了：__________
- 前端是否同步：已同步 / 无需同步（理由：__________）
```

**审查者注意**：
- 改了 `blue_whale_server/` 的 API 路由 → 确认 `blue_whale_web/` 的 Fetch 调用已同步
- 高风险 PR：重点盯核心逻辑边界（鉴权/数据完整性/并发）
- 软字段（设计决策/业务规则/已知风险/用例/边界条件/未完成）填「无」须附理由，裸「无」/「略」/「正常」打回
- 「边界条件审查重点」段 = 请审查者逐条核对，不是摆设

---

## Hook 兜底清单（提交时自动检查）

| 检查项 | 类型 | 说明 |
|---|---|---|
| 禁提交生成物 | 🔴 硬挡 | `graphify-out/` `dist*` `.next/` `__pycache__/` `*.pyc` `.pytest_cache/`（`.claude/` 进仓共享，仅 `settings.local.json` 由 `.gitignore` 忽略，非 hook 拦） |
| 禁 master/main 提交 | 🔴 硬挡 | pre-commit：禁止在 `master`/`main` 上提交。可写任务必须先用 [worktree-workflow.md](worktree-workflow.md) 创建 task worktree + 工单分支 |
| commit 规范 | 🔴 硬挡 | Conventional Commits，格式不符拦截 |
| 前端 lint | 🟡 软提醒 | 改 `blue_whale_web/` 时跑 `npm run lint`，失败只警告不拦 |
| 后端 py_compile | 🟡 软提醒 | 改 `blue_whale_server/` 下 `.py` 时跑 `python -m py_compile`，失败只警告不拦 |
| 禁直推 master/main | 🔴 硬挡 | pre-push：任何本地直推 `master`/`main` 一律拦，合并只在 Gitee 服务端走 PR |
| 工单分支落后拦截 | 🔴 硬挡 | pre-push：工单分支（前缀见 [branch-naming.md](branch-naming.md)）落后于 `origin/master` 时拒绝 push，强制先 rebase |
| AI 破坏性 git 操作 | 🔴 硬挡 | 裸 `--force`/`-f`、对 `master`/`main` 强推、`reset --hard` / `clean -f` / `branch -D` / `checkout .` / `restore .` 均拦；工单分支上的 `--force-with-lease` 放行（前缀见 [branch-naming.md](branch-naming.md)） |
| 工单分支落后软提醒 | 🟡 软提醒 | pre-commit：工单分支（前缀见 [branch-naming.md](branch-naming.md)）落后 `origin/master` 时 `echo` 提示落后提交数，**不拦 commit**（硬拦在 pre-push）。每次 commit 静默 `fetch`。见 [ADR-0006](../adr/0006-sync-mechanism-auto-block.md) |
| squash/rebase 合并拦截 | 🔴 硬挡 | Claude PreToolUse（`block-squash-merge.sh`）：AI 调 `mcp__gitee-ent__merge_enterprise_pull` 时 `merge_method=squash`/`rebase` 一律拦，强制 **merge**（免改写 sha 致 `git branch -d` 失败 + 拦 `-D` 死锁，见 [ADR-0006](../adr/0006-sync-mechanism-auto-block.md)）。人网页操作拦不到，靠自觉 |
| 发布动作标准入口 | 🔴 阻断 / 🟡 用户确认 | Claude PreToolUse（`confirm-release-action.sh`）：直接 `git push` 硬拦；`scripts/publish-review-package.sh` 缺 `--user-authorized` 硬拦；标准入口带 `--user-authorized` 时触发一次确认，脚本推送成功后写入短期发布标记；合法 draft PR 必须消费该标记且 `draft=true` / `target_branch=master`；合并 PR / 创建 release 单独确认 |

> 本表与项目 README 的「Hook 兜底清单」（如有）**同源**——改一处须同步另一处，避免漂移。权威实现以 `.githooks/` + `.claude/hooks/block-dangerous-git.sh` 代码为准。

Hook 脚本：`.githooks/`（`core.hooksPath` 已配）+ `.claude/hooks/`（Claude PreToolUse）。
