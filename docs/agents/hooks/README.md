# Hooks 维护手册

> `.claude/hooks/` 下 PreToolUse 拦截器的**单一权威源**。
> 脚本 + `.claude/settings.json` 挂载点**同源维护**——改任何一处必须同步改另一处。
> 决策背景：补齐 CLAUDE.md「Gitee 工作流」高频硬约束的执行末梢（让红线在 hook 层落地，不只靠文档纪律）。

---

## 现有拦截器清单

| 脚本 | 挂载 matcher | 触发事件 | 作用 | 关联硬约束 |
|---|---|---|---|---|
| `block-dangerous-git.sh` | `Bash` | `PreToolUse` | 拦裸 `--force`、`reset --hard`、`clean -f`、`branch -D`、`checkout .`、`restore .` | CLAUDE.md「提交与审查」 |
| `block-push-to-master.sh` | `Bash` | `PreToolUse` | 拦任何对 `master`/`main` 的 push（显式 + 隐式） | [ADR-0003](../../adr/0003-no-direct-push-to-master.md) |
| `block-squash-merge.sh` | `mcp__gitee__merge_enterprise_pull` | `PreToolUse` | 拦 `merge_method=squash`/`rebase`，强制走 `merge` | CLAUDE.md「合并方法」 |

> `settings.json` 里还有 2 条**纯提醒**型 hook（grep 触发提示用 graphify、Read/Glob 触发提示先查图谱），它们不阻断执行，仅通过 `additionalContext` 注入提示。详见 `.claude/settings.json` 注释。

---

## 新增拦截器 SOP（3 步）

### 1. 写脚本到 `.claude/hooks/<name>.sh`

- **零依赖**：用 `grep`/`sed` 解析 JSON，禁止引 `jq` / `python3 -c` 复杂表达式（部分 hook 在 `python3` 不可用环境要兜底）。
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

### 3. 挂到 `.claude/settings.json`

在 `hooks.PreToolUse[]` 加一条：

```json
{
  "matcher": "Bash|mcp__gitee__merge_enterprise_pull|Read|Glob",
  "hooks": [
    { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/<name>.sh" }
  ]
}
```

要点：
- **`$CLAUDE_PROJECT_DIR`** 必须用，路径才在不同项目根下都对。
- **matcher 精确**：要拦某个 MCP 工具就写完整 `mcp__server__tool_name`，别偷懒写 `mcp__*`（通配不一定生效）。
- **同 matcher 多 hook 用数组**：可以挂多条，独立 exit code（一条拦了不影响另一条放行）。

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

## Hook 失效的 3 个常见原因

| 症状 | 原因 | 排查命令 |
|---|---|---|
| 触发后无任何反应 | 脚本没 `+x` | `ls -la .claude/hooks/<name>.sh` |
| stderr 有报错但工具仍执行 | exit code 不是 0/2 | 在脚本末尾加 `echo "DEBUG exit=$?" >&2` |
| 提醒型 hook 不响应 | 激活条件不满足（如 `graphify-out/graph.json` 缺失） | `[ -f graphify-out/graph.json ] && echo OK` |

---

## 变更检查清单（改 hooks/ 前必过）

- [ ] 新脚本遵循零依赖、stdin 读 JSON、`exit 0/2` 语义
- [ ] `chmod +x` 已执行
- [ ] `.claude/settings.json` 同步更新（matcher + command 路径）
- [ ] 至少 1 个**应当被拦**的测试用例 + 1 个**应当放行**的测试用例跑过
- [ ] 本文档表格里的「现有拦截器清单」同步更新

---

**怎么知道 hook 真的在工作？** —— 故意触发一次被拦的命令，看到 stderr 输出"BLOCKED: …"且 exit=2，就说明整条链路通了。

---

## MCP 合并后清理源分支 SOP

> 适用：用 `mcp__gitee-ent__merge_enterprise_pull` 自审合（低风险 PR）后。
> 来源：实战踩坑 —— PR #7 合并后源分支未自动删除。

### 坑点

`merge_enterprise_pull` 工具签名里虽有 `prune_source_branch` 参数，但**实际可能不生效**（Gitee MCP 服务端兼容性存疑）。表现：

```bash
# 合完 PR #7，git branch -a 应只看到 master，实际：
$ git branch -a
* master
  remotes/origin/master
  remotes/origin/feature/docs-hooks-manual   # ← 还挂着
```

### 清理（2 行，30 秒）

```bash
# 1. 删远程源分支
git push origin :feature/<branch-name>

# 2. 删本地追踪分支（已合并可安全 -d，未合并才需 -D）
git branch -d feature/<branch-name>
```

### 判断用 `-d` 还是 `-D`

| 情况 | 命令 | 原因 |
|---|---|---|
| 分支已合并到 master | `git branch -d` | safe deletion，git 校验过合并历史 |
| 分支未合并就删 | `git branch -D` | 强删 —— 但本项目 AI **禁**用 `-D`（`block-dangerous-git.sh` 会拦） |

> 反过来用：`-d` 报"未合并" = 提醒你"这个分支可能漏合了，先 review 再决定"。

### 防忘窍门

把上面 2 行命令加进你的合并后模板：

```bash
# 合并后必跑（MCP 合并源分支不自动删）
git push origin :<merged-branch> && git branch -d <merged-branch>
```

> 长期方案（可选 follow-up）：写个 `scripts/cleanup-merged-branches.sh`，列出已合并但未删的本地/远程分支，一键清理。暂缓 —— 1 周清一次的频率不值得脚本化。
