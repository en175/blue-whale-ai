# Hooks 维护手册

> `CLAUDE.md` + `AGENTS.md` + `scripts/start-task-worktree.py` 构成平台中立的前置策略；Hook 只做运行时兜底，不是完整安全边界。
> 可跨平台复用的 `.claude/hooks/` 脚本由 ZCode / Claude Code 直接挂载；Codex 通过 `.codex/hooks.json` 和薄 wrapper 复用同一权威实现。Codex 的 `Edit|Write` matcher 仍收到官方 `apply_patch` 输入，由 wrapper 只做输入适配后进入共享 Gate。
> Kimi CLI 不支持项目级 hooks，通过 `scripts/install-kimi-hooks.sh` 把 `.kimi-code/hooks.toml` 写入用户级 `~/.kimi-code/config.toml`，再经用户级 shim 路由回同一权威实现（见「Kimi CLI 挂载」节）。
> 决策背景：补齐 CLAUDE.md「Gitee 工作流」高频硬约束的执行末梢（让红线在 hook 层落地，不只靠文档纪律）。

---

## 现有拦截器清单

| 脚本 | 挂载 matcher | 触发事件 | 作用 | 关联硬约束 |
|---|---|---|---|---|
| `block-master-edit.sh` | ZCode / Claude Code / Codex / Kimi CLI `Edit\|Write` | `PreToolUse` | 四端 master、release 与 detached HEAD 直写兜底；仅精确放行 Git 已忽略的根 `CLAUDE.local.md` 与 `.codex/config.toml`，其他 ignored 文件仍拦。Codex 将 `tool_name=apply_patch`、`tool_input.command` 中的目标路径适配为 Gate 接受的 `Write + file_path`。对仓库内写入的阻断/放行判定追加单行结构化审计记录到 `.git/hook-audit/`（IK10CW），审计只记判定元数据、不改变原 exit code/stdout 契约 | `CLAUDE.md`「可写任务先建 task worktree」 |
| `block-dangerous-git.sh` | `Bash` | `PreToolUse` | 拦裸 `--force`、`reset --hard`、`clean -f`、`branch -D`、`checkout .`、`restore .`；放行/阻断均审计，但只记工具名、稳定操作类别和决定，不记完整命令 | CLAUDE.md「提交与审查」 |
| `block-push-to-master.sh` | `Bash` | `PreToolUse` | 拦任何对 `master`/`main` 的 push（显式 + 隐式）；放行/阻断均审计，但不记完整命令或目标 ref 值 | [ADR-0003](../../adr/0003-no-direct-push-to-master.md) |
| `confirm-release-action.sh` | `Bash` / `mcp__gitee-ent__create_enterprise_repo_pull` / `mcp__gitee-ent__merge_enterprise_pull` / `mcp__gitee-ent__create_enterprise_repo_release` | `PreToolUse` / `PostToolUse` | 任务分支普通 commit/push/merge 放行；任务分支错误 merge/pull 同步、release 工作树直接 commit/pull/merge/rebase/cherry-pick、`release/*` 直推、发布入口缺授权/模式、旧本地 master 集成入口仍硬拦；标准入口带 `--user-authorized` 无交互放行；PR 请求的 draft 须与入口标记一致；**`merge_enterprise_pull` 的 `squash`/`rebase` 方法检查在凭证校验前**（原 `block-squash-merge.sh` 已并入，消除多 hook 执行顺序不确定）；所有 Pre 判定均审计且不记 Bash 命令或 MCP 参数值；PR 标记在 Pre 校验，合并/release 凭证按 `tool_use_id` 原子占用；明确成功 Post 消费，失败/畸形 Post 保留，Post 不审计 | CLAUDE.md「发布动作必须先获用户授权」 / [ADR-0115](../../adr/0115-local-release-code-baseline.md) / [ADR-0011](../../adr/0011-release-marker-consume-after-pr-success.md) / [ADR-0012](../../adr/0012-agent-noninteractive-authorization.md) |
| `block-squash-merge.sh` | _(已并入 `confirm-release-action.sh`，三端配置不再注册)_ | `PreToolUse` | 脚本逻辑保留为独立可测单元（`test-hooks.sh` 仍覆盖），但 squash/rebase 检查职责已迁移到 `confirm-release-action.sh` 内部，消除多 hook 执行顺序不确定导致的纠正信号误导 | CLAUDE.md「合并方法」 |
| `block-issue-without-repo.sh` | `mcp__gitee-ent__create_enterprise_issue` / `mcp__gitee-ent__update_enterprise_issue` | `PreToolUse` | 拦 `project_id` 缺失/为 0；拦子 issue 未带 `project_id/program_id`，强制仓库可见；放行/阻断均审计，但不记企业、仓库、项目、Issue 等 MCP 参数值 | [ADR-0007](../../adr/0007-issue-must-link-repo.md) / [ADR-0008](../../adr/0008-sub-issues-must-inherit-repo.md) |
| `remind-issue-state.sh` | `Bash` / `mcp__gitee-ent__create_enterprise_repo_pull` / `mcp__gitee-ent__merge_enterprise_pull` | `PostToolUse` | **纯提醒型**，四端均挂载但始终 `exit 0`，不阻断、不审计、不自动改状态：worktree 入口带 `--issue` 成功后提醒核对准入与授权；PR 创建后按授权提醒审查标签；PR 合并后提醒按测试、部署与共同验收证据保留真实阶段，不自动完成工作项。规则见 `docs/agents/issue-tracker.md`「任务状态与真实交付」 | CLAUDE.md「任务状态」 |

> CBM 纯提醒型 Hook 仅注入探索协议入口，始终放行。五端配置与上下文通道见 [CBM 五端探索提醒](#cbm-五端探索提醒)。探索提醒与会话上下文注入均不参与阻断契约的等价比较。`remind-issue-state.sh` 也是纯提醒型（PostToolUse，恒 `exit 0`），但 gitee MCP 四端可用，故四端均挂载、参与 shape 等价比较。

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
- **ZCode 事件白名单**：`.zcode/config.json` 的 `hooks.events` 只认 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop` 七个事件，且是严格 schema——出现白名单外事件名（如 Claude Code/Codex 支持的 `SubagentStart`）会让**整个配置文件**加载失败，该文件声明的全部 Hook 静默失效（IKJGD5）。五端复制配置时必须按端核对事件清单。
- **matcher 精确**：要拦某个 MCP 工具就写完整 `mcp__server__tool_name`，别偷懒写 `mcp__*`（通配不一定生效）。
- **同 matcher 多 hook 用数组**：可以挂多条，独立 exit code（一条拦了不影响另一条放行）。
- 同名、同输入结构的工具可直接复用；输入结构不同时只允许在平台薄适配层做格式转换，不得复制 Gate 策略。Codex 的官方写入工具名是 `apply_patch`，补丁固定读取 `tool_input.command`，由 `Edit|Write` matcher 对应的 wrapper 适配后复用 `block-master-edit.sh`。ZCode 的写入工具名就是 `Edit`/`Write`、路径在 `tool_input.file_path`，与 Claude Code 同构，直接挂权威 Gate 无需适配层。

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
  - Kimi 的 SessionStart 是观察型事件（fire-and-forget，stdout 不注入上下文；compaction 走独立 PreCompact/PostCompact 观察事件）。注入型的 `cbm-session-reminder.sh` 挂载到 kimi 即为死配置，因此 `.kimi-code/hooks.toml` 不挂 SessionStart。kimi 会话启动 context 由原生 AGENTS.md 加载机制覆盖（项目 AGENTS.md 指向 CLAUDE.md，规则路由完整）。
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

1. **先做写入前主动自检**：按 `CLAUDE.md`「写入前自检」确认当前分支、Agent 任务区、目标路径和 Git 写入区域。若仍在 master 或 release 工作树，停止写入，从当前发布线运行 `scripts/start-task-worktree.sh`。
2. **检查四端配置映射**：运行 `python3 scripts/check-hook-contracts.py`。它从 ZCode、Claude Code、Codex、Kimi CLI 的实际项目配置解析 matcher、执行入口与权威 Gate；失败信息会指出平台、事件、matcher 和 Gate。
3. **执行配置链闭环**：运行 `python3 scripts/check-hook-closed-loop.py`。它逐端执行 master 与 Agent 任务区的创建/修改场景，并按唯一会话标识和工具调用标识核对阻断/放行结果与审计记录。
4. **按关联标识定位记录**：使用下节的 `python3 scripts/query-hook-audit.py` 查询。master 和 release 直写应为 exit 2，Agent 任务区等价写入应为 exit 0，且每个工具调用标识只对应一条记录。
5. **最后检查外部客户端**：若真实 ZCode、Claude Code、Codex 或 Kimi CLI 操作没有关联记录，再检查该客户端的 Hook 信任状态、配置加载结果和自身日志（ZCode 日志在 `~/.zcode/cli/log/zcode-<日期>.jsonl`：配置整体被拒记 `config.file.invalid`——例如 `hooks.events` 出现白名单外事件名；Hook 执行失败记 `hook.run.failed`）。仓库查询只能定位调用是否进入 Gate，不能解释外部 harness 的内部根因。

这条路径保持“文档驱动、Hook 兜底”：第 1 步是 Agent 正常执行机制，第 2–4 步验证仓库兜底与审计，第 5 步才进入外部客户端取证。

### 证据等级

| 等级 | 证明范围 | 对应入口 |
|---|---|---|
| 直接 Gate 黑盒 | 直接向权威 Gate 输入 JSON，验证 exit code、stdout/stderr 与审计副作用；不证明平台实际加载了配置 | `bash scripts/test-hooks.sh` 中各 Gate 黑盒用例 |
| 配置链集成 | 从仓库实际配置解析 matcher 和 command，再执行到共享 Gate 并关联审计；`probe-codex-write-hook.sh` / `probe-zcode-write-hook.sh` 也属于此等级（后者先校验 ZCode 事件白名单） | `python3 scripts/check-hook-closed-loop.py`、`bash scripts/probe-codex-write-hook.sh`、`bash scripts/probe-zcode-write-hook.sh` |
| 外部客户端实机探针 | 在真实 ZCode、Claude Code 或 Codex 客户端触发调用，并以客户端提供的关联标识查到仓库审计 | 需在对应客户端环境单独取证，仓库自动化不能替代 |

测试报告必须标明等级。直接 Gate 黑盒或配置链集成通过，不能表述为外部客户端实机探针已通过。

## 查询阻断型 PreToolUse 审计记录

运行时已注册的五个阻断型 PreToolUse Gate 共享 `.git/hook-audit/` 下的单行 JSON 审计契约。主检出区和 task worktree 通过 Git common dir 看到同一组日志；每个 Gate 有一个活跃 `.log` 和至多一个 `.log.1` 归档。记录时间为 UTC，核心字段为 `timestamp`、`hook`、`tool`、`operation`、`session_id`、`tool_use_id`、`exit_code` 和稳定 `reason`。保护分支写入 Gate 还保留目标 `file_path` 与 `branch`；其余 Bash/MCP Gate 的这两个字段为空，避免复制命令或工具参数。

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

5 个 hook 同构：`printf '<json>' | bash <hook>.sh` 的 **stdin JSON → exit code + stdout/stderr** 黑盒。夹具不测内部实现；同一黑盒边界还观测 git common dir 中的持久日志、脱敏内容与审计失败降级，`block-master-edit.sh` 另覆盖 release 直写、轮转和并发副作用。`confirm-release-action.sh` 覆盖任务分支普通 commit/push/merge 放行、同步/create/update 标准入口无输出放行、缺授权/缺模式/发布基线直推/错误 merge 同步及复合命令/Git alias 绕过硬拦、凭证 TTL/对象隔离/并发占用、Post 明确成功消费和失败/畸形保留，并断言 Post 不生成 PreToolUse 审计记录。Hook 不执行同步、不选择发布模式；正常状态机由 `CLAUDE.md` 和 ADR-0013 驱动。发布标记、动作凭证与审计日志测试均在临时 Git 仓库运行，不读写真实 common dir。

夹具还校验 ZCode / Claude Code / Codex / Kimi CLI 挂载层：
- `.zcode/config.json`、`.claude/settings.json`、`.codex/hooks.json`、`.kimi-code/hooks.toml` 必须存在。
- 平台中立的**阻断型** `PreToolUse` / `PostToolUse` 事件、matcher、Hook 数量和权威 Gate 必须四端等价。
- CBM 探索提醒与会话上下文注入按客户端实际能力挂载，不参与阻断契约的等价比较，配置见 [CBM 五端探索提醒](#cbm-五端探索提醒)。
- 所有 Codex 脚本 command 必须通过 `.codex/hooks/run-claude-pretool.sh`，不得直接指向 `.claude/hooks/` 或复制出来的 `.codex/hooks/` 实现。
- 每个 Codex 包装命令必须和同位置 ZCode / Claude Code Hook 挂载的脚本名一致。
- 代表性 Codex 包装命令必须从 `.codex/hooks.json` 读取，并能从 repo root 调到权威脚本得到相同拦截/放行结果。
- `bash scripts/probe-codex-write-hook.sh` 必须读取真实 `.codex/hooks.json`，以官方 `apply_patch` 形状探测真实 wrapper → 共享 Gate，证明 master 与 release 创建/修改阻断、任务区创建/修改放行且不实际执行补丁。
- `bash scripts/probe-zcode-write-hook.sh` 必须读取真实 `.zcode/config.json`，先证明 `hooks.events` 全部事件落在 ZCode 七事件白名单内（白名单外事件会让整个配置文件被拒载、全部 Hook 静默失效），再以 `Edit`/`Write` + `tool_input.file_path` 形状直探共享 Gate，证明 master 与 release 检出区创建/修改阻断、任务区创建/修改放行且不实际写文件。
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
| ZCode hook 全部不响应 | `.zcode/config.json` 的 `hooks.events` 含白名单外事件（如 `SubagentStart`），整个文件加载失败 | `grep config.file.invalid ~/.zcode/cli/log/zcode-$(date +%F).jsonl` 看诊断信息；删除白名单外事件后重开会话 |
| Kimi CLI hook 不响应 | 未安装用户级 shim/配置，或会话未重载 | 运行 `scripts/install-kimi-hooks.sh`，然后 `kimi doctor` 校验并重开会话（或 `/reload`） |

---

## 变更检查清单（改 hooks/ 前必过）

- [ ] 新脚本遵循解析策略、stdin 读 JSON、`exit 0/2` 语义
- [ ] `chmod +x` 已执行
- [ ] `.zcode/config.json`、`.claude/settings.json`、`.codex/hooks.json`、`.kimi-code/hooks.toml` 同步更新（事件 + matcher + Hook 数量 + 权威 Gate）；**阻断型 Pre/Post 必须四端同步**
- [ ] Codex command 经 `.codex/hooks/run-claude-pretool.sh` 指向 `.claude/hooks/` 权威 Gate；`apply_patch` 只做输入适配，不复制策略
- [ ] 提醒型 `Grep|Glob` 或 `SessionStart` 未同步时，排除理由仍分别满足“非阻断且按客户端实际事件适配”与“会话 context 注入而非工具 Gate”
- [ ] 至少 1 个**应当被拦**的测试用例 + 1 个**应当放行**的测试用例跑过
- [ ] **输入 JSON 字段类型以 MCP `tools/list` schema 为准**（不要凭直觉只写字符串值——`project_id` / `program_id` / `parent_id` 在 schema 里是 number，PR #11 / IJZ5WA 复现过 string-only 正则漏 number 形态的假绿）
- [ ] 跑 `python3 scripts/check-hook-contracts.py`、`bash scripts/probe-codex-write-hook.sh`、`bash scripts/probe-zcode-write-hook.sh`、`bash scripts/test-hooks.sh`，全部退出 0 才提交
- [ ] 本文档表格里的「现有拦截器清单」同步更新

---

**怎么知道 hook 真的在工作？** —— 故意触发一次被拦的命令，看到 stderr 输出"BLOCKED: …"且 exit=2，就说明整条链路通了。

---

## MCP 合并后清理本地任务区

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

Agent 必须在对应 task worktree 内执行清理脚本。脚本抓取任务元数据记录的目标 release，证明远端目标包含当前 HEAD，复核工作区干净和远端 SHA，再删除本地任务 worktree 与分支。远程源分支保留，由负责人另行决定去向。

### 清理判据

`scripts/cleanup-task-worktree.sh` 先抓取元数据记录的远端目标 release，确认任务 HEAD 已进入该提交，再通过 `ls-remote` 复核远端 SHA。工作区干净时，入口删除本地 worktree，并用 `git update-ref -d` 删除本地任务分支。它不使用 `git branch -d` 判断是否合并，也不删除远程源分支。

远端目标未包含任务 HEAD、远端不可达或工作区有未保存改动时，入口拒绝清理。不要用 `git branch -D` 绕过判据，`block-dangerous-git.sh` 也会拦截该命令。

### 防忘窍门

把清理脚本加进你的合并后模板：

```bash
# 合并后必跑（MCP 合并源分支不自动删）
scripts/cleanup-task-worktree.sh
```

> 人在 Gitee 网页手动合并时，也可以直接勾「删除源分支」。


## CBM 五端探索提醒

行为权威：[仓库代码探索协议](../../../agent-rules/code-discovery.md)。根规则只有短入口。

共享实现为 `.claude/hooks/lib/cbm_context.py`，两个既有 shell 入口调用它。输入 `cwd` 与脚本所属仓库的 Git common directory 必须一致，非本仓静默放行；不因为用户级官方 Hook 存在而跳过项目提醒。不会调用索引、修改 Git 状态或阻断工具。

| 客户端 | 配置 | 上下文通道 |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | SessionStart、SubagentStart、PreToolUse；JSON additionalContext |
| Codex | `.codex/hooks.json` | 同上，通过现有 wrapper；仍须客户端信任项目 Hook |
| ZCode | `.zcode/config.json` | 无 SubagentStart：`hooks.events` 严格 schema 只认七事件（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop），白名单外事件使整个配置文件被拒载（IKJGD5），子代理注入通道平台不支持；严格 JSON；Bash 搜索纳入 matcher |
| Kimi Code CLI | `.kimi-code/hooks.toml` 经既有安装器挂载 | UserPromptSubmit 返回文本；SessionStart/SubagentStart 是观察事件，不作注入通道 |
| Qoder CLI | `.qoder/settings.json` | 项目级 SessionStart、SubagentStart、PreToolUse；JSON additionalContext |

Kimi 运行 `scripts/install-kimi-hooks.sh` 幂等更新已有 managed block；其他仓库没有本项目脚本与标记时不生效。新增提醒不改变其他安全 Hook 的行为。五端统一行为，不要求事件数相等；阻断型旧契约仍由原检查器独立守护。

子代理工具与上下文继承必须实际确认；不能查询的子代理由父代理传入规则及证据。恢复或切换目录后按协议重新核验 project，不假定客户端会触发 CwdChanged。

### 五端验收

每端分别记录配置检查、上下文实际注入、Agent 实际查询三层结果。覆盖：首次只读探索、worktree 切换、子代理能力/交接、失败或覆盖不足降级、无关仓库静默。普通 Read/编辑/日志检索不应被阻断。客户端不存在、未认证或不支持事件时标注具体未验证项，禁止记为通过。

自动验证：`python3 -m unittest scripts.tests.test_cbm_context`、`python3 scripts/check-hook-contracts.py`（完整 TOML 检查需 Python 3.11+）。测试验证提醒载荷、隔离与不阻断；客户端验收另需真实会话的输入和调用记录，不能以测试通过代替。

官方参考：[Kimi Hooks](https://moonshotai.github.io/kimi-code/en/customization/hooks)、[Qoder Hooks](https://docs.qoder.com/cli/hooks)、[CBM](https://github.com/DeusData/codebase-memory-mcp)。版本差异以本机实测为准。

## Gitee 渠道门禁

操作规则唯一来源为 [Gitee MCP 操作渠道](../../../agent-rules/gitee-mcp-only.md)。共享 shell Gate 调用 `lib/gitee_channel.py`，五端以 `PreToolUse` 的全工具 matcher 挂载；四端旧契约检查器继续检查 Claude Code、Codex、ZCode、Kimi，新增专项测试检查 Qoder 的门禁配置。

Gate 对 Gitee MCP 放行，拒绝可见的 Gitee HTTP 请求、直接调用的替代脚本、Gitee 浏览器页面和目标不明的浏览器调用。已选标签页的无 URL 操作不会因缺少 Gitee 字符串而自动放行。携带明确非 Gitee URL 的浏览器调用及普通本地产品测试命令可放行；浏览器 JavaScript 只做有限的 URL 模式识别，不证明整段程序、已有 tab、重定向或 cookie 上下文安全。需要连续 GUI 操作却无法携带目标的客户端仍可能被保守阻断，应报告该能力边界。

审计沿用 `lib/hook_audit.py`，只记录工具名、关联 ID、判定和稳定原因，不记录命令、代码、URL、请求参数或凭据。仓库范围以 Gate 所在 checkout 与事件 cwd 的 Git common directory 判定，同仓 worktree 适用，无关仓库静默放行。

验收分三层：共享 Gate 黑盒测试、配置到 Gate 的调用链、真实客户端工具调用与审计关联。专项命令为 `python3.12 -m unittest scripts.tests.test_gitee_channel`；旧契约继续运行 `python3.12 scripts/check-hook-contracts.py` 与 `bash scripts/test-hooks.sh`。不能用前两层通过替代第三层。

| 客户端 | 配置及调用链 | 真实客户端覆盖 |
| --- | --- | --- |
| Claude Code | 项目配置调用共享 Gate | 待实际会话验证 |
| Codex | 项目配置经现有 wrapper 调用共享 Gate | CLI 探针启动被既有 model catalog 配置错误阻断，未验证；新 Hook 需客户端信任 |
| ZCode | 七事件白名单内增加 PreToolUse Gate | 待实际会话验证 |
| Kimi Code | opt-in shim 路由共享 Gate | 安装器更新后新会话或 reload；待真实调用验证 |
| Qoder | 项目配置调用共享 Gate | 待实际会话验证 |

Codex 嵌套工具调用按官方 Hook 路径仍可接受 PreToolUse 检查，须用当前客户端实测。`write_stdin` 不再次触发 PreToolUse；hosted 工具和部分 specialized 路径可能不触发 Hook。任意间接脚本、编码地址、代理和网络重定向不在静态检查的完整证明范围。未加载/未信任 Hook、Kimi 异常 fail-open 等属于已知边界，不得报告所有替代入口已经硬封禁。
