# Hooks 维护手册

> `CLAUDE.md` + `AGENTS.md` + `scripts/start-task-worktree.py` 构成平台中立的前置策略；Hook 只做运行时兜底，不是完整安全边界。
> 可跨平台复用的 `.claude/hooks/` 脚本由 Claude Code 直接挂载，Codex 通过 `.codex/hooks.json` 指向同一实现。Claude 专属 `Edit|Write` 主检出区防护不在 Codex 复制无效 matcher。
> 决策背景：补齐 CLAUDE.md「Gitee 工作流」高频硬约束的执行末梢（让红线在 hook 层落地，不只靠文档纪律）。

---

## 现有拦截器清单

| 脚本 | 挂载 matcher | 触发事件 | 作用 | 关联硬约束 |
|---|---|---|---|---|
| `block-master-edit.sh` | Claude Code `Edit\|Write` | `PreToolUse` | Claude Code 主检出区写入兜底；其他 Agent 由 `AGENTS.md` 前置策略约束 | `CLAUDE.md`「可写任务先建 task worktree」 |
| `block-dangerous-git.sh` | `Bash` | `PreToolUse` | 拦裸 `--force`、`reset --hard`、`clean -f`、`branch -D`、`checkout .`、`restore .` | CLAUDE.md「提交与审查」 |
| `block-push-to-master.sh` | `Bash` | `PreToolUse` | 拦任何对 `master`/`main` 的 push（显式 + 隐式） | [ADR-0003](../../adr/0003-no-direct-push-to-master.md) |
| `confirm-release-action.sh` | `Bash` / `mcp__gitee-ent__create_enterprise_repo_pull` / `mcp__gitee-ent__merge_enterprise_pull` / `mcp__gitee-ent__create_enterprise_repo_release` | `PreToolUse` / `PostToolUse` | 提交入口 `commit-task-for-review.sh` 出现即放行（worktree commit 本地可逆，无需授权）；发布/合入标准入口带 `--user-authorized` 无交互放行；直接 push/commit/非 ff-only merge（含复合命令和 Git alias）硬拦；**`merge_enterprise_pull` 的 `squash`/`rebase` 方法检查在凭证校验前**（原 `block-squash-merge.sh` 已并入，消除多 hook 执行顺序不确定）；PR 标记在 Pre 校验，合并/release 凭证按 `tool_use_id` 原子占用；明确成功 Post 消费，失败/畸形 Post 保留 | CLAUDE.md「发布动作必须先获用户授权」 / [ADR-0010](../../adr/0010-local-master-is-user-integration-zone.md) / [ADR-0011](../../adr/0011-release-marker-consume-after-pr-success.md) / [ADR-0012](../../adr/0012-agent-noninteractive-authorization.md) |
| `block-squash-merge.sh` | _(已并入 `confirm-release-action.sh`，三端配置不再注册)_ | `PreToolUse` | 脚本逻辑保留为独立可测单元（`test-hooks.sh` 仍覆盖），但 squash/rebase 检查职责已迁移到 `confirm-release-action.sh` 内部，消除多 hook 执行顺序不确定导致的纠正信号误导 | CLAUDE.md「合并方法」 |
| `block-issue-without-repo.sh` | `mcp__gitee-ent__create_enterprise_issue` / `mcp__gitee-ent__update_enterprise_issue` | `PreToolUse` | 拦 `project_id` 缺失/为 0；拦子 issue 未带 `project_id/program_id`，强制仓库可见 | [ADR-0007](../../adr/0007-issue-must-link-repo.md) / [ADR-0008](../../adr/0008-sub-issues-must-inherit-repo.md) |

> `settings.json` 里有 1 条**纯提醒**型 hook（`Grep|Glob` → `cbm-discovery-gate.sh`，提示先查 CBM 图谱），不阻断执行、仅注入 context；Codex 无对应 MCP，`.codex/hooks.json` 不挂此 gate（允许缺失，见下「测试边界」）。

---

## 新增拦截器 SOP（3 步）

### 1. 写脚本到 `.claude/hooks/<name>.sh`

- **解析策略**：普通校验 hook 可用 `grep`/`sed` 做轻量解析；发布、删除、强推、合并这类安全敏感 hook 必须使用真实 JSON 解析和 shell token 解析，优先复用 `.claude/hooks/lib/pretool.py`，避免转义引号或 `git -C ...` 这类形式绕过。
- **stdin 读 JSON**：PreToolUse 会把 `{tool_input, tool_name, ...}` 喂到 stdin，先 `INPUT=$(cat)`，再提取 `tool_input.command` 或 `tool_input.merge_method` 等。
- **退出码语义**：
  - `exit 0` = 放行
  - `exit 2` = 阻断（stderr 输出原因，stdout 必须空，否则会污染 Claude 上下文）
  - 其它 = 视为错误，工具调用也会被拒
- **错误信息给原因 + 改法**：拦截时别只说"被拦了"，要告诉 AI"改成 X"。

### 2. `chmod +x` 设可执行

```bash
chmod +x .claude/hooks/<name>.sh
```

> **未执行可执行权限** = hook 静默失效（`type: command` 不带 `bash` 前缀时，Claude Code 不会自动加执行位）。这是 90% 的"hook 不工作"故障的根因。

### 3. 挂到 `.claude/settings.json` 和 `.codex/hooks.json`

在 `hooks.PreToolUse[]` 加一条：

```json
{
  "matcher": "Bash|mcp__gitee-ent__merge_enterprise_pull|Read|Glob",
  "hooks": [
    { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/<name>.sh" }
  ]
}
```

要点：
- **`$CLAUDE_PROJECT_DIR`** 必须用，路径才在不同项目根下都对。
- **matcher 精确**：要拦某个 MCP 工具就写完整 `mcp__server__tool_name`，别偷懒写 `mcp__*`（通配不一定生效）。
- **同 matcher 多 hook 用数组**：可以挂多条，独立 exit code（一条拦了不影响另一条放行）。
- 只有目标平台确实暴露同名、同输入结构的工具 matcher 才复用。不要为了表面对称，把 Claude 的 `Edit|Write` matcher 原样复制到使用不同写入工具名的平台。

Codex 挂载点写在 `.codex/hooks.json`，但**不要复制脚本实现到 `.codex/hooks/`**。Codex command 统一通过薄 wrapper 定位 `.claude/hooks`：

```json
{
  "type": "command",
  "command": "bash \"$(git rev-parse --show-toplevel)/.codex/hooks/run-claude-pretool.sh\" <name>.sh"
}
```

原因：
- `.claude/hooks` 是唯一脚本源，避免 Claude/Codex 两套实现漂移。
- `.codex/hooks/run-claude-pretool.sh` 是透明 wrapper：同一权威脚本在 Claude/Codex 都使用“stdout 空 + exit 0 放行 / exit 2 阻断”的契约，不再产生或转换 ASK。
- `.codex/config.toml` 属于本机私密配置，可能含 token，不进仓；项目共享的只有 `.codex/hooks.json`。
- Codex 首次拉取或 hook 变更后，用户需要在 Codex 里运行 `/hooks` review/trust 项目 hook，否则新挂载点不会执行。

---

## 调试 Hook

### 单条命令喂 stdin 验证

```bash
# 拦 push 到 master
echo '{"tool_input":{"command":"git push origin master"}}' \
  | bash .claude/hooks/block-push-to-master.sh
echo "EXIT=$?"   # 期望 2
```

### 看实际 stdout / stderr 分流

```bash
echo '{"tool_input":{"command":"..."}}' \
  | bash .claude/hooks/<name>.sh \
  > /tmp/hook_stdout.txt 2> /tmp/hook_stderr.txt
echo "stdout=$(cat /tmp/hook_stdout.txt)"
echo "stderr=$(cat /tmp/hook_stderr.txt)"
echo "exit=$?"
```

### 触发后再读 Claude Code 日志

Hook 触发记录在 `~/.claude/logs/` 或本会话 transcript 里搜 `hookSpecificOutput`。

---

## 测试夹具（`scripts/test-hooks.sh`）

> 纯 bash 黑盒夹具，对每个 hook 喂 stdin JSON、断言 exit code（0/2）+ stderr 含关键串，一键跑，退出码反映通过/失败。**改 hook 前先跑它。**

```bash
bash scripts/test-hooks.sh     # 退出码 0 = 全用例通过
```

### 测试边界（seam）

5 个 hook 同构：`printf '<json>' | bash <hook>.sh` 的 **stdin JSON → exit code + stdout/stderr** 黑盒。夹具不测内部实现，只测这条边界。`confirm-release-action.sh` 覆盖同步/create/update 标准入口无输出放行、缺授权/缺模式/直接 push/错误 merge 同步及复合命令/Git alias 绕过硬拦、凭证 TTL/对象隔离/并发占用、Post 明确成功消费和失败/畸形保留。Hook 不执行同步、不选择发布模式；正常状态机由 `CLAUDE.md` 和 ADR-0013 驱动。发布标记与动作凭证测试均在临时 Git 仓库运行，不读写真实 common dir。

夹具还校验 Codex 挂载层：
- `.codex/hooks.json` 必须存在。
- 平台中立的**阻断型** gate 及全部 `PostToolUse` matcher + hook 数量必须与 `.claude/settings.json` 一致；提醒型 gate 与 Claude 专属 `Edit|Write` 兜底允许 Codex 缺失。
- 所有 Codex 脚本 command 必须通过 `.codex/hooks/run-claude-pretool.sh`，不得直接指向 `.claude/hooks/` 或复制出来的 `.codex/hooks/` 实现。
- 每个 Codex 包装命令必须和同位置 Claude hook 挂载的脚本名一致。
- 代表性 Codex 包装命令必须从 `.codex/hooks.json` 读取，并能从 repo root 调到权威脚本得到相同拦截/放行结果。
- 可执行 Hook、wrapper 和活跃规则禁止返回 ASK 决策；标准授权路径必须在 Claude/Codex 均无交互放行。
- `.gitignore` 必须只放行 `.codex/hooks.json` 和 `.codex/hooks/run-claude-pretool.sh`；`.codex/config.toml`、其它 `.codex/*`、其它 `.codex/hooks/*` 均保持忽略。

### 字段类型以 MCP schema 为准（核心教训）

写测试输入时，**JSON 字段类型以 MCP `tools/list` 返回的 schema 为准**，不要凭直觉只写字符串值。血泪：

- `project_id`、`program_id`、`parent_id` 在 `mcp__gitee-ent__create_enterprise_issue` / `mcp__gitee-ent__update_enterprise_issue` 的 schema 里是 **number**（`"project_id":48854568`），不是 string。
- PR #11 的 `block-issue-without-repo.sh` 首版正则只匹配 string 形态（`"project_id":"..."`），漏了 number；手写「三场景空跑」又都凭直觉写了字符串 → **假绿**，上线即瘫痪（IJZ5WA 复现），靠 code review 才抓出。
- 子 issue 的父子关系也走 number 字段：`parent_id` 非 0 时必须同时带有效 `project_id/program_id`，否则仓库 Issues/MCP 仓库过滤查不到（IJZ74J-N 复现）。

夹具里的回归基线（`string-only 正则在 number 形态下漏检`）就是防这个：把 hook 正则退回 string-only 再跑，number 用例必须报红。新增 hook 用到 MCP 字段时，照此同时覆盖 schema 的所有原生类型形态。

---

## Hook 失效的 3 个常见原因

| 症状 | 原因 | 排查命令 |
|---|---|---|
| 触发后无任何反应 | 脚本没 `+x` | `ls -la .claude/hooks/<name>.sh` |
| stderr 有报错但工具仍执行 | exit code 不是 0/2 | 在脚本末尾加 `echo "DEBUG exit=$?" >&2` |
| 提醒型 hook 不响应 | 激活条件不满足（如 `graphify-out/graph.json` 缺失） | `[ -f graphify-out/graph.json ] && echo OK` |
| Codex hook 不响应 | `.codex/hooks.json` 未被信任 | 在 Codex 里运行 `/hooks`，review 并 trust 项目 hook |

---

## 变更检查清单（改 hooks/ 前必过）

- [ ] 新脚本遵循解析策略、stdin 读 JSON、`exit 0/2` 语义
- [ ] `chmod +x` 已执行
- [ ] `.claude/settings.json` 同步更新（matcher + command 路径）
- [ ] `.codex/hooks.json` 同步更新（matcher + command 路径，脚本 command 指向 `.claude/hooks/`）；**阻断型 gate 必须双系统同步**，提醒型 gate（`cbm-discovery-gate.sh`）允许 Codex 缺失
- [ ] 至少 1 个**应当被拦**的测试用例 + 1 个**应当放行**的测试用例跑过
- [ ] **输入 JSON 字段类型以 MCP `tools/list` schema 为准**（不要凭直觉只写字符串值——`project_id` / `program_id` / `parent_id` 在 schema 里是 number，PR #11 / IJZ5WA 复现过 string-only 正则漏 number 形态的假绿）
- [ ] 跑 `bash scripts/test-hooks.sh`，全绿才提交（退出码 0 = 通过）
- [ ] 本文档表格里的「现有拦截器清单」同步更新

---

**怎么知道 hook 真的在工作？** —— 故意触发一次被拦的命令，看到 stderr 输出"BLOCKED: …"且 exit=2，就说明整条链路通了。

---

## MCP 合并后清理源分支 SOP

> 适用：用户明确授权后，用 `mcp__gitee-ent__merge_enterprise_pull` 合并低风险 PR 后。
> 来源：实战踩坑 —— PR #7 合并后源分支未自动删除。

### 坑点

`merge_enterprise_pull` 工具**当前签名无 `prune_source_branch` 参数**（Gitee REST API 有，但未暴露给此 MCP），且 Gitee merge **默认不删**源分支。表现：

```bash
# 合完 PR #7，git branch -a 应只看到 master，实际：
$ git branch -a
* master
  remotes/origin/master
  remotes/origin/feature/docs-hooks-manual   # ← 还挂着
```

### 清理

```bash
scripts/cleanup-task-worktree.sh
```

Agent 必须在对应 task worktree 内执行清理脚本。脚本会先证明当前分支已被 `origin/master` 包含、工作区干净、路径位于 task worktree，再删除远程源分支、本地分支和 worktree。

### 判断用 `-d` 还是 `-D`

| 情况 | 命令 | 原因 |
|---|---|---|
| 分支已合并到 master | `git branch -d` | safe deletion，git 校验过合并历史 |
| 分支未合并就删 | `git branch -D` | 强删 —— 但本项目 AI **禁**用 `-D`（`block-dangerous-git.sh` 会拦） |

> 反过来用：`-d` 报"未合并" = 提醒你"这个分支可能漏合了，先 review 再决定"。

### 防忘窍门

把清理脚本加进你的合并后模板：

```bash
# 合并后必跑（MCP 合并源分支不自动删）
scripts/cleanup-task-worktree.sh
```

> 人在 Gitee 网页手动合并时，也可以直接勾「删除源分支」。
