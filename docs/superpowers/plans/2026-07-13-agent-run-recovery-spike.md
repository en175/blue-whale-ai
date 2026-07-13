# AgentRun Recovery Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可删除的终端 Spike，用真实 Pydantic AI Slim、AgentScope Core 和 FakeOrchestrator 证明 AgentRun 可持久化暂停/跨进程恢复，并与独立 GenerationJob 解耦。

**Architecture:** Blue-Whale 纯领域模型和 SQLite 是唯一权威，候选框架只通过 `OrchestratorPort` 产生产品中性命令和不透明 checkpoint。独立 Worker 进程只推进 GenerationJob；服务层负责事务、幂等、租约、事件序列和恢复编排。

**Tech Stack:** Python 3.11、标准库 `sqlite3`/`asyncio`、`uv`、`pydantic-ai-slim==2.9.0`、`agentscope==2.0.4`、ANSI 终端。

## Global Constraints

- 只写 `blue_whale_server/prototypes/agent_run_recovery/`、本计划和最终验证结论；不接入 FastAPI、前端或正式后端依赖。
- LLM、图片和视频供应商全部使用确定性本地实现，不读取 API Key，不发起付费调用。
- SQLite 默认路径为 `/tmp/blue-whale-agent-run-recovery-prototype.sqlite3`，必须可由 `--reset` 删除重建。
- Pydantic AI 精确固定 `2.9.0`；AgentScope 精确固定 `2.0.4`；运行环境固定 Python 3.11。
- 产品表不保存框架类型；checkpoint 只保存 `engine`、`engine_version`、`schema_version` 和 JSON payload。
- 活动 checkpoint 不做跨框架迁移；同一个 Run 只能由其记录的引擎版本恢复。
- 遵循 `/prototype` 明确规则，不新增 pytest/正式测试套件；每个任务以可执行探针、`py_compile` 或 `--demo` 场景验证。
- 遵循仓库“一张子 issue 一个 commit”：任务中间不提交；全部验证后运行 `scripts/commit-task-for-review.sh --amend -m 'feat: 验证AgentRun恢复与任务解耦'`。
- 不修改 `CONTEXT.md`：AgentRun、GenerationJob 和 Asset 术语已经存在且与设计一致。

---

## File Structure

### Create

- `blue_whale_server/prototypes/agent_run_recovery/__init__.py`：原型包标识和版本常量。
- `blue_whale_server/prototypes/agent_run_recovery/__main__.py`：命令行入口与子命令路由。
- `blue_whale_server/prototypes/agent_run_recovery/requirements.txt`：两个精确候选版本。
- `blue_whale_server/prototypes/agent_run_recovery/README.md`：问题、一次性声明、单命令运行方法和快捷键。
- `blue_whale_server/prototypes/agent_run_recovery/domain.py`：纯产品枚举、不可变记录、命令与状态转换。
- `blue_whale_server/prototypes/agent_run_recovery/store.py`：SQLite schema、事务和查询投影。
- `blue_whale_server/prototypes/agent_run_recovery/service.py`：断点事务、幂等、租约、恢复与重试用例。
- `blue_whale_server/prototypes/agent_run_recovery/job_results.py`：不加载编排适配器的 Job 结果事务。
- `blue_whale_server/prototypes/agent_run_recovery/worker.py`：独立 Job Worker 单步执行入口。
- `blue_whale_server/prototypes/agent_run_recovery/tui.py`：稳定单屏交互和自动演示。
- `blue_whale_server/prototypes/agent_run_recovery/adapters/__init__.py`：适配器工厂。
- `blue_whale_server/prototypes/agent_run_recovery/adapters/base.py`：`OrchestratorPort` 及产品中性 DTO。
- `blue_whale_server/prototypes/agent_run_recovery/adapters/fake.py`：无第三方依赖的替换基线。
- `blue_whale_server/prototypes/agent_run_recovery/adapters/pydantic_ai.py`：Pydantic deferred tool 适配器。
- `blue_whale_server/prototypes/agent_run_recovery/adapters/agentscope.py`：AgentScope external execution 适配器。
- `blue_whale_server/prototypes/agent_run_recovery/NOTES.md`：自动演示证据和人工结论。

### Modify at completion

- `docs/superpowers/plans/2026-07-13-agent-run-recovery-spike.md`：勾选已完成步骤。

---

### Task 1: 固定环境并建立产品中性端口

**Files:**

- Create: `blue_whale_server/prototypes/agent_run_recovery/__init__.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/requirements.txt`
- Create: `blue_whale_server/prototypes/agent_run_recovery/adapters/base.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/domain.py`

**Interfaces:**

- Produces: `RunRequest`、`OpaqueCheckpoint`、`ExternalResult`、`CreateGenerationJob`、`VisibleEvent`、`StepOutcome`、`OrchestratorPort`。
- Produces: `RunState`、`PauseReason`、`JobState`、`AgentRun`、`GenerationJob`、`Asset`、`transition_run()`、`finish_job()`。

- [x] **Step 1: 固定原型依赖**

写入：

```text
pydantic-ai-slim==2.9.0
agentscope==2.0.4
```

运行：

```bash
uv run --python 3.11 \
  --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
  python -c "import agentscope, pydantic_ai; print(agentscope.__version__, pydantic_ai.__version__)"
```

预期输出同时包含 `2.0.4` 和 `2.9.0`。

- [x] **Step 2: 定义产品中性编排端口**

在 `adapters/base.py` 定义以下不可变 DTO 和协议：

```python
from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class RunRequest:
    run_id: str
    prompt: str
    expected_outputs: int


@dataclass(frozen=True)
class OpaqueCheckpoint:
    engine: str
    engine_version: str
    schema_version: int
    payload: str


@dataclass(frozen=True)
class ExternalResult:
    framework_call_id: str
    summary: str


@dataclass(frozen=True)
class CreateGenerationJob:
    framework_call_id: str
    expected_outputs: int


@dataclass(frozen=True)
class VisibleEvent:
    kind: str
    message: str


@dataclass(frozen=True)
class StepOutcome:
    checkpoint: OpaqueCheckpoint
    job_request: CreateGenerationJob | None
    visible_events: Sequence[VisibleEvent]
    completed: bool


class OrchestratorPort(Protocol):
    engine: str
    engine_version: str

    async def start(self, request: RunRequest) -> StepOutcome:
        raise NotImplementedError

    async def resume(
        self,
        checkpoint: OpaqueCheckpoint,
        results: list[ExternalResult],
    ) -> StepOutcome:
        raise NotImplementedError
```

- [x] **Step 3: 定义纯领域状态和合法转换**

在 `domain.py` 使用 `str, Enum` 和 frozen dataclass 固定：

```python
class RunState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_USER = "awaiting_user"
    AWAITING_JOB = "awaiting_job"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PauseReason(str, Enum):
    MANUAL_PAUSE = "manual_pause"


class JobState(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    PARTIALLY_SUCCEEDED = "partially_succeeded"
    FAILED = "failed"
```

`transition_run(run, target, pause_reason=None)` 必须拒绝终态重开，以及从 `awaiting_user/manual_pause` 直接创建新 Job。`finish_job(job, succeeded_outputs)` 必须按 `0`、部分、全部输出分别得到 `failed`、`partially_succeeded`、`succeeded`，且终态再次写入时抛出 `InvalidTransition`。

- [x] **Step 4: 验证模块可编译且无第三方类型泄漏**

运行：

```bash
uv run --python 3.11 \
  --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
  python -m py_compile \
  blue_whale_server/prototypes/agent_run_recovery/domain.py \
  blue_whale_server/prototypes/agent_run_recovery/adapters/base.py
rg -n "pydantic_ai|agentscope" \
  blue_whale_server/prototypes/agent_run_recovery/domain.py \
  blue_whale_server/prototypes/agent_run_recovery/adapters/base.py
```

预期：`py_compile` 成功；`rg` 无匹配并以状态 1 退出。

---

### Task 2: 实现并单独探测三个编排适配器

**Files:**

- Create: `blue_whale_server/prototypes/agent_run_recovery/adapters/fake.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/adapters/pydantic_ai.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/adapters/agentscope.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/adapters/__init__.py`

**Interfaces:**

- Consumes: Task 1 的 `OrchestratorPort` DTO。
- Produces: `create_adapter(name: str) -> OrchestratorPort`，支持 `fake`、`pydantic-ai`、`agentscope`。

- [x] **Step 1: 实现 FakeOrchestrator 基线**

`start()` 返回固定 call id `fake-generate-1`、expected outputs 和 JSON checkpoint；`resume()` 要求结果 call id 匹配 checkpoint，随后返回 `completed=True`。checkpoint payload 至少包含：

```json
{"framework_call_id":"fake-generate-1","phase":"awaiting_job"}
```

使用 `json.dumps(payload, sort_keys=True, separators=(",", ":"))` 确保确定性。

- [x] **Step 2: 实现真实 Pydantic AI deferred tool 接点**

适配器使用已探测可运行的 API：

```python
from pydantic_ai import (
    Agent,
    CallDeferred,
    DeferredToolRequests,
    DeferredToolResults,
)
from pydantic_ai.messages import ModelMessagesTypeAdapter
from pydantic_ai.models.test import TestModel


agent = Agent(TestModel(), output_type=[str, DeferredToolRequests])


@agent.tool_plain
async def generate_media(count: int) -> str:
    raise CallDeferred()
```

`start()` 调用 `agent.run()`，断言 output 为 `DeferredToolRequests`，读取 `calls[0].tool_call_id`，用 `ModelMessagesTypeAdapter.dump_json(result.all_messages()).decode()` 保存 checkpoint。Job 的 `expected_outputs` 必须取产品输入 `request.expected_outputs`，不得信任 TestModel 生成的 count。`resume()` 用 `ModelMessagesTypeAdapter.validate_json()` 恢复消息，并调用：

```python
DeferredToolResults(
    calls={result.framework_call_id: result.summary},
)
```

恢复后的 output 必须是字符串并映射为 `completed=True`。

- [x] **Step 3: 实现真实 AgentScope external execution 接点**

建立确定性 `ChatModelBase` 子类：没有 tool result 时返回 `ToolCallBlock(id="call-1", name="generate_media", input='{"count":4}')`；存在 tool result 时返回 `TextBlock(text="done")`。

外部工具使用 `FunctionTool` 子类，在构造后设置 `is_external_tool=True`，并使 `check_permissions()` 返回：

```python
PermissionDecision(
    behavior=PermissionBehavior.ALLOW,
    message="allowed by deterministic spike",
)
```

`start()` 消费 `agent.reply_stream(UserMsg(name="user", content=request.prompt))`，捕获 `RequireExternalExecutionEvent`，用 `agent.state.model_dump_json()` 保存 checkpoint。`resume()` 用 `AgentState.model_validate_json()` 重建 Agent，再投递：

```python
ExternalExecutionResultEvent(
    reply_id=stored_reply_id,
    execution_results=[
        ToolResultBlock(
            id=result.framework_call_id,
            name="generate_media",
            output=result.summary,
            state=ToolResultState.SUCCESS,
        ),
    ],
)
```

checkpoint payload 同时保存 `reply_id` 和 `AgentState` JSON；适配器只向外返回产品中性 DTO。

- [x] **Step 4: 为三个适配器增加独立 probe 函数**

在 `adapters/__init__.py` 增加 `async def probe_adapter(name: str) -> str`，依次调用 `start()`、JSON 往返 checkpoint、`resume()`，输出：

```text
PROBE engine=pydantic-ai deferred=true restored=true completed=true leaked_types=false
```

运行三个精确探针：

```bash
for engine in fake pydantic-ai agentscope; do
  ENGINE="$engine" uv run --python 3.11 \
    --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
    python -c 'import asyncio, os; from blue_whale_server.prototypes.agent_run_recovery.adapters import probe_adapter; print(asyncio.run(probe_adapter(os.environ["ENGINE"])))'
done
```

预期：三行均包含五个固定字段，布尔值全部为 `true`。

---

### Task 3: 实现 SQLite 事务、幂等、租约和独立 Job Worker

**Files:**

- Create: `blue_whale_server/prototypes/agent_run_recovery/store.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/service.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/job_results.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/worker.py`

**Interfaces:**

- Consumes: `OrchestratorPort`、领域 dataclass 和转换函数。
- Produces: `PrototypeStore`、`AgentRunService`、`run_worker_once(db_path, job_id, succeeded_outputs, notification_id)`。

- [x] **Step 1: 建立最小 SQLite schema 和事务包装**

`PrototypeStore.initialize()` 创建：

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  pause_reason TEXT,
  display_stage TEXT NOT NULL,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  checkpoint_schema_version INTEGER NOT NULL,
  checkpoint_payload TEXT NOT NULL,
  version INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at REAL
);
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  framework_call_id TEXT NOT NULL,
  retry_of_job_id TEXT,
  state TEXT NOT NULL,
  expected_outputs INTEGER NOT NULL,
  succeeded_outputs INTEGER NOT NULL,
  frozen_input TEXT NOT NULL,
  UNIQUE(run_id, framework_call_id)
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  output_slot INTEGER NOT NULL,
  url TEXT NOT NULL,
  UNIQUE(job_id, output_slot)
);
CREATE TABLE run_events (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  PRIMARY KEY(run_id, sequence),
  UNIQUE(run_id, dedupe_key)
);
CREATE TABLE idempotency_records (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL
);
```

所有写操作经 `transaction()` context manager 执行，异常时显式 rollback。

- [x] **Step 2: 实现原子创建 Job 断点**

`AgentRunService.advance_run(run_id, failpoint=None)`：取得租约、调用适配器、再在同一数据库事务中幂等插入 Job、保存 checkpoint、转态到 `awaiting_job` 并写事件。`failpoint == "after_job_insert"` 时在事务内部抛 `InjectedFailure`。

执行故障注入后查询必须满足：Job 数量为 0、Run 仍为 `running`、事件序列未增加。

- [x] **Step 3: 实现 Job 完成幂等事务**

`record_job_result(job_id, succeeded_outputs, notification_id)` 使用 `f"notify:{notification_id}"` 作为幂等键；首次处理按输出槽位创建 Asset 并终结 Job，重复处理返回 `changed=False`。禁止修改已有 Job 终态。

- [x] **Step 4: 实现手动暂停、恢复和只补缺失输出**

- `manual_pause(run_id)`：只允许 `running` 或 `awaiting_job` 转到 `awaiting_user/manual_pause`，不改 Job；
- `resume_run(run_id)`：取得租约，先读取 Job/Asset 产品事实，再调用匹配版本适配器；
- `retry_missing(run_id, old_job_id)`：计算 `expected_outputs - succeeded_outputs`，创建带 `retry_of_job_id` 的新 Job，旧 Job 不变。

- [x] **Step 5: 实现事件游标和租约接管**

`events_after(run_id, cursor)` 只返回 `sequence > cursor` 的升序产品事件。`acquire_lease(run_id, owner, now, ttl=5.0)` 只允许空租约、同 owner 或已过期租约；另一个未过期 owner 得到 `LeaseBusy`。

- [x] **Step 6: 证明 Worker 是独立进程**

`worker.py` 只接收数据库路径、Job id、成功输出数和通知 id；由 `job_results.py` 执行产品事务，不得直接或间接加载任何 adapters 模块，并提供自己的 argparse 入口。主进程通过 `subprocess.run()` 调用：

```bash
python -m blue_whale_server.prototypes.agent_run_recovery.worker \
  --db /tmp/blue-whale-agent-run-recovery-prototype.sqlite3 \
  --job-id job-1 --succeeded 2 --notification partial-1
```

运行 `rg -n "adapters|pydantic_ai|agentscope" worker.py` 预期无匹配。

---

### Task 4: 构建单屏 TUI 和可重复自动演示

**Files:**

- Create: `blue_whale_server/prototypes/agent_run_recovery/__main__.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/tui.py`
- Create: `blue_whale_server/prototypes/agent_run_recovery/README.md`

**Interfaces:**

- Consumes: `create_adapter()`、`PrototypeStore`、`AgentRunService`、Worker 子命令。
- Produces: `probe`、`demo`、`interactive`、`worker` 四个 CLI 子命令。

- [x] **Step 1: 实现 argparse 入口**

支持：

```text
probe --engine fake|pydantic-ai|agentscope
demo --engine fake|pydantic-ai|agentscope --db PATH --reset
interactive --engine fake|pydantic-ai|agentscope --db PATH --reset
matrix --db-dir PATH --reset
worker --db PATH --job-id ID --succeeded N --notification ID
```

未知引擎或缺参数由 argparse 返回状态 2。

- [x] **Step 2: 实现稳定单屏渲染**

每次输入前输出 `\x1b[2J\x1b[H`，按以下顺序渲染：

1. 问题与一次性原型警告；
2. AgentRun 完整状态和 checkpoint 元数据；
3. Job、Asset 与重试关系；
4. 客户端 cursor、最近产品事件和最近动作是否改变状态；
5. 快捷键。

快捷键固定为：`[n] new`、`[a] advance`、`[p] pause`、`[w] worker partial`、`[d] duplicate`、`[x] exit`、`[r] resume`、`[m] retry missing`、`[f] finish retry`、`[c] disconnect`、`[e] reconnect`、`[q] quit`。

- [x] **Step 3: 实现固定 demo 场景**

`demo` 对每条通过标准输出明确行，例如 `PASS atomic_checkpoint`，并在末尾输出 JSON summary：

```json
{
  "assets": 4,
  "duplicate_changed": false,
  "engine": "pydantic-ai",
  "events_ordered": true,
  "final_run_state": "completed",
  "jobs": 2,
  "old_job_state": "partially_succeeded",
  "retry_job_state": "succeeded"
}
```

当原子断点条件不满足时输出 `FAIL atomic_checkpoint` 并以状态 1 退出；其他条件使用各自的固定名称。

`matrix` 在独立数据库中运行三个 `demo`，比较 Run 最终状态、Job 关联、Job 状态和完整产品事件类型序列；只有形状完全一致时输出 `PASS cross_engine_product_shape`。

- [x] **Step 4: 写 README 单命令和人工路径**

README 顶部明确：`PROTOTYPE — 回答问题后删除，不是生产实现`。单命令为：

```bash
uv run --python 3.11 \
  --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
  python -m blue_whale_server.prototypes.agent_run_recovery interactive \
  --engine pydantic-ai --reset
```

README 逐键列出人工路径：`n → a → p → w → d → x`，重新运行不带 `--reset` 后执行 `r → m → f → c → e`。

---

### Task 5: 运行证据矩阵、记录结论并交给用户验证

**Files:**

- Create: `blue_whale_server/prototypes/agent_run_recovery/NOTES.md`
- Modify: `docs/superpowers/plans/2026-07-13-agent-run-recovery-spike.md`

**Interfaces:**

- Consumes: 全部 CLI 子命令。
- Produces: 三引擎证据、依赖版本证据、人工验证命令和 Wayfinder resolution 输入。

- [x] **Step 1: 运行语法和工作区检查**

```bash
uv run --python 3.11 \
  --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
  python -m compileall -q blue_whale_server/prototypes/agent_run_recovery
git diff --check
```

预期两个命令状态均为 0。

- [x] **Step 2: 运行三引擎自动演示**

```bash
uv run --python 3.11 \
  --with-requirements blue_whale_server/prototypes/agent_run_recovery/requirements.txt \
  python -m blue_whale_server.prototypes.agent_run_recovery matrix --reset
```

预期三个 demo 和矩阵状态均为 0；每次 summary 都满足 assets=4、jobs=2、final_run_state=completed、duplicate_changed=false，且矩阵输出 `product_shapes_equal=true`。

- [x] **Step 3: 检查边界泄漏**

```bash
rg -n "pydantic_ai|agentscope" \
  blue_whale_server/prototypes/agent_run_recovery/domain.py \
  blue_whale_server/prototypes/agent_run_recovery/store.py \
  blue_whale_server/prototypes/agent_run_recovery/service.py \
  blue_whale_server/prototypes/agent_run_recovery/worker.py
```

预期无匹配；第三方 import 只允许出现在各自 adapter 文件。

- [x] **Step 4: 记录 NOTES**

NOTES 必须记录：精确版本、Python 版本、三次 summary、每条通过标准的结果、框架差异、未验证项，以及“尚待用户人工交互确认”。不得把未运行的真实供应商、正式 SSE 或生产性能写成已验证。

- [x] **Step 5: 更新索引并 amend 唯一任务提交**

先运行 `graphify update .`，再运行：

```bash
scripts/commit-task-for-review.sh --amend \
  -m "feat: 验证AgentRun恢复与任务解耦"
```

验证 `git status --short` 为空，`git log -1 --oneline` 只有本子 issue 的一个任务提交。

- [x] **Step 6: 交给用户人工驱动**

向用户提供 README 单命令和固定按键路径。用户未确认前：

- 不关闭“验证 AgentRun 暂停恢复与生成任务解耦”；
- 不更新 Wayfinder 地图 Decisions so far；
- 不删除原型；
- 不合入本地 master、不 push、不创建 PR。

---

### Task 6: 用户确认后的 Wayfinder 收口

**Files:**

- Delete after answer capture: `blue_whale_server/prototypes/agent_run_recovery/` 中除 `NOTES.md` 外的一次性运行代码；若 issue 评论已完整保存结论，可连同 `NOTES.md` 一并删除。
- Modify: `docs/superpowers/plans/2026-07-13-agent-run-recovery-spike.md`

**Interfaces:**

- Consumes: 用户人工验证反馈。
- Produces: 子票 resolution comment、关闭状态、地图 Decisions so far 指针和必要的新前沿票。

- [x] **Step 1: 捕获人工结论**

把用户确认的预期行为、发现的反直觉点和最终采用门槛写入目标子票的 resolution comment。若用户发现模型缺陷，返回 Task 4 修正并重新验证，不得强行通过。

- [x] **Step 2: 删除或吸收一次性代码**

原型回答问题后用 `apply_patch` 删除运行代码；保留结论的唯一权威位置为 issue resolution comment。再次运行 `git diff --check`。

- [x] **Step 3: 修订唯一任务提交**

运行标准 amend 入口，确保最终 commit 只保留值得长期保存的规格/结论，不保留腐烂 TUI。

- [x] **Step 4: 按 Wayfinder 顺序更新 Gitee**

1. 给“验证 AgentRun 暂停恢复与生成任务解耦”发布 resolution comment；
2. 查询“需求”类型状态并改为“已完成”；
3. 重新读取地图“规划 Agent 创作后端架构与开源脚手架选型”的最新正文；
4. 只在 `## Decisions so far` 追加一行标题链接和一句 gist；
5. 根据结论创建并连线新票，或明确记录没有 fog 毕业；
6. 验证子票 closed 且地图正文包含唯一指针。
