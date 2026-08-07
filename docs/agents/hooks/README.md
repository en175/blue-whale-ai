# Hooks 维护手册

> `CLAUDE.md` + `AGENTS.md` + `scripts/start-task-worktree.py` 构成平台中立的前置策略；Hook 只做运行时兜底，不是完整安全边界。
> 可跨平台复用的 `.claude/hooks/` 脚本由 ZCode / Claude Code 直接挂载；Codex 通过 `.codex/hooks.json` 和薄 wrapper 复用同一权威实现。Codex 的 `Edit|Write` matcher 仍收到官方 `apply_patch` 输入，由 wrapper 只做输入适配后进入共享 Gate。
> Kimi CLI 不支持项目级 hooks，通过 `scripts/install-kimi-hooks.sh` 把 `.kimi-code/hooks.toml` 写入用户级 `~/.kimi-code/config.toml`，再经用户级 shim 路由回同一权威实现（见「Kimi CLI 挂载」节）。
> 决策背景：补齐 CLAUDE.md「Gitee 工作流」高频硬约束的执行末梢（让红线在 hook 层落地，不只靠文档纪律）。

---

## 现有拦截器清单

| 脚本 | 挂载 matcher | 触发事件 | 作用 | 关联硬约束 |
|---|---|---|---|---|
| `block-master-edit.sh` | ZCode / Claude Code / Codex `Edit\|Write` | `PreToolUse` | 三端主检出区写入兜底；仅精确放行 Git 已忽略的根 `CLAUDE.local.md` 与 `.codex/config.toml`，其他 ignored 文件仍拦。Codex 将 `tool_name=apply_patch`、`tool_input.command` 中的目标路径适配为 Gate 接受的 `Write + file_path`。对仓库内写入的阻断/放行判定追加单行结构化审计记录到 `.git/hook-audit/`（IK10CW），审计只记判定元数据、不改变原 exit code/stdout 契约 | `CLAUDE.md`「可写任务先建 task worktree」 |
| `block-dangerous-git.sh` | `Bash` | `PreToolUse` | 拦裸 `--force`、`reset --hard`、`clean -f`、`branch -D`、`checkout .`、`restore .`；放行/阻断均审计，但只记工具名、稳定操作类别和决定，不记完整命令 | CLAUDE.md「提交与审查」 |
| `block-push-to-master.sh` | `Bash` | `PreToolUse` | 拦任何对 `master`/`main` 的 push（显式 + 隐式）；放行/阻断均审计，但不记完整命令或目标 ref 值 | [ADR-0003](../../adr/0003-no-direct-push-to-master.md) |
| `confirm-release-action.sh` | `Bash` / `mcp__gitee-ent__create_enterprise_repo_pull` / `mcp__gitee-ent__merge_enterprise_pull` / `mcp__gitee-ent__create_enterprise_repo_release` | `PreToolUse` / `PostToolUse` | 提交入口 `commit-task-for-review.sh` 出现即放行（worktree commit 本地可逆，无需授权）；发布/合入标准入口带 `--user-authorized` 无交互放行；直接 push/commit/非 ff-only merge（含复合命令和 Git alias）硬拦；**`merge_enterprise_pull` 的 `squash`/`rebase` 方法检查在凭证校验前**（原 `block-squash-merge.sh` 已并入，消除多 hook 执行顺序不确定）；所有 Pre 判定均审计且不记 Bash 命令或 MCP 参数值；PR 标记在 Pre 校验，合并/release 凭证按 `tool_use_id` 原子占用；明确成功 Post 消费，失败/畸形 Post 保留，Post 不审计 | CLAUDE.md「发布动作必须先获用户授权」 / [ADR-0010](../../adr/0010-local-master-is-user-integration-zone.md) / [ADR-0011](../../adr/0011-release-marker-consume-after-pr-success.md) / [ADR-0012](../../adr/0012-agent-noninteractive-authorization.md) |
| `block-squash-merge.sh` | _(已并入 `confirm-release-action.sh`，三端配置不再注册)_ | `PreToolUse` | 脚本逻辑保留为独立可测单元（`test-hooks.sh` 仍覆盖），但 squash/rebase 检查职责已迁移到 `confirm-release-action.sh` 内部，消除多 hook 执行顺序不确定导致的纠正信号误导 | CLAUDE.md「合并方法」 |
| `block-issue-without-repo.sh` | `mcp__gitee-ent__create_enterprise_issue` / `mcp__gitee-ent__update_enterprise_issue` | `PreToolUse` | 拦 `project_id` 缺失/为 0；拦子 issue 未带 `project_id/program_id`，强制仓库可见；放行/阻断均审计，但不记企业、仓库、项目、Issue 等 MCP 参数值 | [ADR-0007](../../adr/0007-issue-must-link-repo.md) / [ADR-0008](../../adr/0008-sub-issues-must-inherit-repo.md) |
| `remind-issue-state.sh` | `Bash` / `mcp__gitee-ent__create_enterprise_repo_pull` / `mcp__gitee-ent__merge_enterprise_pull` | `PostToolUse` | **纯提醒型**，四端均挂载但始终 `exit 0`，不阻断、不审计、不自动改状态：worktree 入口带 `--issue` 成功后提醒置「进行中/修复中」；PR 创建后提醒打 `ready-for-review`；PR 合并后提醒置「已完成/已修复」（缺陷另打「修复待验证」）。状态机规则见 `docs/agents/issue-tracker.md`「任务状态机」 | CLAUDE.md「任务状态机」 |

> ZCode / Claude Code 配置里有 1 条**纯提醒**型 hook（`Grep|Glob` → `cbm-discovery-gate.sh`，提示先查 CBM 图谱），不阻断执行、仅注入 context；Codex 无对应 CBM MCP，因此 `.codex/hooks.json` 不挂此 gate。`SessionStart` 同样显式排除：它只在会话启动/恢复时注入 context，不是工具调用 Gate，且各平台生命周期挂载不同。两者均不参与阻断等价比较。`remind-issue-state.sh` 也是纯提醒型（PostToolUse，恒 `exit 0`），但 gitee MCP 四端可用，故四端均挂载、参与 shape 等价比较。

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

### 3. 挂到 ZCode / Claude Code / Codex / Kimi CLI 四端配置

在 `.zcode/config.json`、`.claude/settings.json`、`.codex/hooks.json` 和 `.kimi-code/hooks.toml` 的 `PreToolUse` 中加入等价阻断契约（ZCode 位于 `hooks.events.PreToolUse`，Kimi 为 `[[hooks]]` 扁平条目，其余两端位于 `hooks.PreToolUse`）。ZCode / Claude Code 的 command 直接挂权威 Gate，例如：

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
- 同名、同输入结构的工具可直接复用；输入结构不同时只允许在平台薄适配层做格式转换，不得复制 Gate 策略。Codex 的官方写入工具名是 `apply_patch`，补丁固定读取 `tool_input.command`，由 `Edit|Write` matcher 对应的 wrapper 适配后复用 `block-master-edit.sh`。

Codex 挂载点写在 `.codex/hooks.json`，但**不要复制脚本实现到 `.codex/hooks/`**。Codex command 统一通过薄 wrapper 定位 `.claude/hooks`：

```json
{
  "type": "command",
  "command": "bash \"$(git rev-parse --show-toplevel)/.codex/hooks/run-claude-pretool.sh\" <name>.sh"
}
```

原因：
- `.claude/hooks` 是 ZCode / Claude Code / Codex 的唯一脚本源，避免三套实现漂移。
- `.codex/hooks/run-claude-pretool.sh` 对普通 Gate 透明转发；仅对 `apply_patch → block-master-edit.sh` 做目标路径适配。三端都使用“stdout 空 + exit 0 放行 / stderr 原因 + exit 2 阻断”的契约，不产生或转换 ASK。
- `CLAUDE.local.md` 与 `.codex/config.toml` 属于本机私密配置，可能含个人指令或 token，不进仓；master 写入 Gate 只有在 `git check-ignore` 命中时才允许 Agent 修改它们。项目共享的只有 `.codex/hooks.json`。
- Codex 首次拉取或 hook 变更后，用户需要在 Codex 里运行 `/hooks` review/trust 项目 hook，否则新挂载点不会执行。

---

## Kimi CLI 挂载（用户级 shim）

Kimi CLI 只从用户级 `~/.kimi-code/config.toml` 加载 hooks（实测项目级 `.kimi-code/local.toml` 不加载），无法像其它三端一样把配置入库生效。适配方式：

- **配置片段入库**：`.kimi-code/hooks.toml` 收录与三端阻断/观察契约一一对应的 `[[hooks]]` 条目（10 PreToolUse + 6 PostToolUse），command 统一指向用户级 shim。
- **shim 路由**：`scripts/install-kimi-hooks.sh` 把 `.kimi-code/hooks/blue-whale-hook.sh` 同步到 `~/.kimi-code/hooks/` 并把片段以 managed block 写入用户级配置（`--uninstall` 干净移除）。shim 带 opt-in 标记守卫：仅当会话项目根存在 `.kimi-code/hooks.toml` 才路由到 `.claude/hooks/<gate>`，本机其它项目静默放行、零干扰。
- **载荷差异已由 Gate 层吸收**（对 Claude 系行为无影响）：
  - Kimi 的关联 id 字段是 `tool_call_id`（无 `tool_use_id`）——`lib/pretool.py` 与 `lib/hook_audit.py` 做回退映射，授权 claim 与审计关联不变。
  - Kimi 的 Write/Edit 目标路径参数是 `tool_input.path`（无 `file_path`）——同样由上述回退吸收，`block-master-edit.sh` 的分支判定与审计不变。
  - Kimi 的 PostToolUse 成功输出字段是 `tool_output`（无 `tool_response`），且仅在工具成功时触发（失败走 `PostToolUseFailure`）——`confirm-release-action.sh` 的成功判定兼容两种形状，PR 标记撕票语义不变。
  - Kimi 的 SessionStart 是观察型事件（fire-and-forget，stdout 不注入上下文；compaction 走独立 PreCompact/PostCompact 观察事件）。注入型的 `cbm-session-reminder.sh` / `superpowers-session-start.sh` 挂载到 kimi 即为死配置，因此 `.kimi-code/hooks.toml` 不挂 SessionStart。kimi 会话启动 context 由原生 AGENTS.md 加载机制覆盖（项目 AGENTS.md 指向 CLAUDE.md，规则路由完整）；superpowers 引导在 kimi 无 hook 等价物。
- 阻断契约一致：`exit 0` 放行、`stderr + exit 2` 阻断、其它非零 fail-open。注意 Kimi 的 fail-open 是官方设计，hooks 同样只是兜底而非完整安全边界。
- 使用 kimi 的本机首次（或换新机）运行一次 `scripts/install-kimi-hooks.sh`；变更 `.kimi-code/hooks.toml` 或 shim 后重跑一次即可幂等同步。新会话生效，已有会话用 `/reload` 重载。
- 目前 Kimi CLI 为个人使用（非团队平台）：配置入库不是为团队分发，而是机制必需——task worktree 从 git 提交状态创建，`.kimi-code/hooks.toml`（opt-in 标记）与 shim 权威源若不入库，worktree 会话中 hook 会静默失效；入库同时让契约/闭环检查器可持续守护四端一致。

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

## 新人闭环排障路径

按下面的顺序排查，不要把 Hook 当作正常开工入口：

1. **先做写入前主动自检**：按 `CLAUDE.md`「写入前自检」确认当前分支、Agent 任务区、目标路径和 Git 写入区域。若仍在用户本地集成区，停止写入并先运行 `scripts/start-task-worktree.sh`。
2. **检查四端配置映射**：运行 `python3 scripts/check-hook-contracts.py`。它从 ZCode、Claude Code、Codex、Kimi CLI 的实际项目配置解析 matcher、执行入口与权威 Gate；失败信息会指出平台、事件、matcher 和 Gate。
3. **执行配置链闭环**：运行 `python3 scripts/check-hook-closed-loop.py`。它逐端执行 master 与 Agent 任务区的创建/修改场景，并按唯一会话标识和工具调用标识核对阻断/放行结果与审计记录。
4. **按关联标识定位记录**：使用下节的 `python3 scripts/query-hook-audit.py` 查询。master 写入应为 exit 2，Agent 任务区等价写入应为 exit 0，且每个工具调用标识只对应一条记录。
5. **最后检查外部客户端**：若真实 ZCode、Claude Code、Codex 或 Kimi CLI 操作没有关联记录，再检查该客户端的 Hook 信任状态、配置加载结果和自身日志。仓库查询只能定位调用是否进入 Gate，不能解释外部 harness 的内部根因。

这条路径保持“文档驱动、Hook 兜底”：第 1 步是 Agent 正常执行机制，第 2–4 步验证仓库兜底与审计，第 5 步才进入外部客户端取证。

### 证据等级

| 等级 | 证明范围 | 对应入口 |
|---|---|---|
| 直接 Gate 黑盒 | 直接向权威 Gate 输入 JSON，验证 exit code、stdout/stderr 与审计副作用；不证明平台实际加载了配置 | `bash scripts/test-hooks.sh` 中各 Gate 黑盒用例 |
| 配置链集成 | 从仓库实际配置解析 matcher 和 command，再执行到共享 Gate 并关联审计；`probe-codex-write-hook.sh` 也属于此等级 | `python3 scripts/check-hook-closed-loop.py`、`bash scripts/probe-codex-write-hook.sh` |
| 外部客户端实机探针 | 在真实 ZCode、Claude Code 或 Codex 客户端触发调用，并以客户端提供的关联标识查到仓库审计 | 需在对应客户端环境单独取证，仓库自动化不能替代 |

测试报告必须标明等级。直接 Gate 黑盒或配置链集成通过，不能表述为外部客户端实机探针已通过。

## 查询阻断型 PreToolUse 审计记录

运行时已注册的五个阻断型 PreToolUse Gate 共享 `.git/hook-audit/` 下的单行 JSON 审计契约。主检出区和 task worktree 通过 Git common dir 看到同一组日志；每个 Gate 有一个活跃 `.log` 和至多一个 `.log.1` 归档。记录时间为 UTC，核心字段为 `timestamp`、`hook`、`tool`、`operation`、`session_id`、`tool_use_id`、`exit_code` 和稳定 `reason`。master 写入 Gate 还保留目标 `file_path` 与 `branch`；其余 Bash/MCP Gate 的这两个字段为空，避免复制命令或工具参数。

稳定查询入口可同时按起始时间、会话标识和工具调用标识筛选；不需要的条件省略：

```bash
python3 scripts/query-hook-audit.py \
  --from-utc "2026-07-14T00:00:00+00:00" \
  --session-id "<session-id>" \
  --tool-use-id "<tool-use-id>"
```

查询不到指定关联标识时，命令明确输出 `未进入仓库 Hook 执行链`。这只表示该调用没有进入仓库 Gate，不能解释外部 harness 的内部根因；继续排查时应结合对应客户端的 Hook 信任状态、配置加载结果和自身日志。

---

## 测试夹具（`scripts/test-hooks.sh`）

> 纯 bash 黑盒夹具，对每个 hook 喂 stdin JSON、断言 exit code（0/2）+ stderr 含关键串，一键跑，退出码反映通过/失败。**改 hook 前先跑它。**

```bash
bash scripts/test-hooks.sh     # 退出码 0 = 全用例通过
```

### 测试边界（seam）

5 个 hook 同构：`printf '<json>' | bash <hook>.sh` 的 **stdin JSON → exit code + stdout/stderr** 黑盒。夹具不测内部实现；同一黑盒边界还观测 git common dir 中的持久日志、脱敏内容与审计失败降级，`block-master-edit.sh` 另覆盖轮转和并发副作用。`confirm-release-action.sh` 覆盖同步/create/update 标准入口无输出放行、缺授权/缺模式/直接 push/错误 merge 同步及复合命令/Git alias 绕过硬拦、凭证 TTL/对象隔离/并发占用、Post 明确成功消费和失败/畸形保留，并断言 Post 不生成 PreToolUse 审计记录。Hook 不执行同步、不选择发布模式；正常状态机由 `CLAUDE.md` 和 ADR-0013 驱动。发布标记、动作凭证与审计日志测试均在临时 Git 仓库运行，不读写真实 common dir。

夹具还校验 ZCode / Claude Code / Codex / Kimi CLI 挂载层：
- `.zcode/config.json`、`.claude/settings.json`、`.codex/hooks.json`、`.kimi-code/hooks.toml` 必须存在。
- 平台中立的**阻断型** `PreToolUse` / `PostToolUse` 事件、matcher、Hook 数量和权威 Gate 必须四端等价。
- 提醒型 `Grep|Glob` 只注入 context、不阻断，且 Codex 无对应 CBM MCP；`SessionStart` 只注入会话启动/恢复 context、不是工具调用 Gate，且各平台生命周期挂载不同（Kimi 仅 `startup|resume`）。两者显式排除于阻断等价比较。
- 所有 Codex 脚本 command 必须通过 `.codex/hooks/run-claude-pretool.sh`，不得直接指向 `.claude/hooks/` 或复制出来的 `.codex/hooks/` 实现。
- 每个 Codex 包装命令必须和同位置 ZCode / Claude Code Hook 挂载的脚本名一致。
- 代表性 Codex 包装命令必须从 `.codex/hooks.json` 读取，并能从 repo root 调到权威脚本得到相同拦截/放行结果。
- `bash scripts/probe-codex-write-hook.sh` 必须读取真实 `.codex/hooks.json`，以官方 `apply_patch` 形状探测真实 wrapper → 共享 Gate，证明 master 创建/修改阻断、任务区创建/修改放行且不实际执行补丁。
- Kimi CLI shim 在参数异常、非 git 目录、无 `.kimi-code/hooks.toml` opt-in 标记、Gate 缺失时一律静默放行；标记与 Gate 齐备时 stdin 与 exit code/stderr 原样透传（Slice 7）。
- 可执行 Hook、wrapper 和活跃规则禁止返回 ASK 决策；标准授权路径必须在 ZCode / Claude Code / Codex / Kimi CLI 均无交互放行。
- `.gitignore` 必须忽略根 `CLAUDE.local.md`；`.codex/` 只放行 `.codex/hooks.json` 和 `.codex/hooks/run-claude-pretool.sh`，`.codex/config.toml`、其它 `.codex/*`、其它 `.codex/hooks/*` 均保持忽略。`.kimi-code/hooks.toml` 与 `.kimi-code/hooks/` 可提交，`.kimi-code/local.toml` 保持忽略。

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
| Kimi CLI hook 不响应 | 未安装用户级 shim/配置，或会话未重载 | 运行 `scripts/install-kimi-hooks.sh`，然后 `kimi doctor` 校验并重开会话（或 `/reload`） |

---

## 变更检查清单（改 hooks/ 前必过）

- [ ] 新脚本遵循解析策略、stdin 读 JSON、`exit 0/2` 语义
- [ ] `chmod +x` 已执行
- [ ] `.zcode/config.json`、`.claude/settings.json`、`.codex/hooks.json`、`.kimi-code/hooks.toml` 同步更新（事件 + matcher + Hook 数量 + 权威 Gate）；**阻断型 Pre/Post 必须四端同步**
- [ ] Codex command 经 `.codex/hooks/run-claude-pretool.sh` 指向 `.claude/hooks/` 权威 Gate；`apply_patch` 只做输入适配，不复制策略
- [ ] 提醒型 `Grep|Glob` 或 `SessionStart` 未同步时，排除理由仍分别满足“非阻断且 Codex 无对应 CBM MCP”与“会话 context 注入而非工具 Gate”
- [ ] 至少 1 个**应当被拦**的测试用例 + 1 个**应当放行**的测试用例跑过
- [ ] **输入 JSON 字段类型以 MCP `tools/list` schema 为准**（不要凭直觉只写字符串值——`project_id` / `program_id` / `parent_id` 在 schema 里是 number，PR #11 / IJZ5WA 复现过 string-only 正则漏 number 形态的假绿）
- [ ] 跑 `python3 scripts/check-hook-contracts.py`、`bash scripts/probe-codex-write-hook.sh`、`bash scripts/test-hooks.sh`，全部退出 0 才提交
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
