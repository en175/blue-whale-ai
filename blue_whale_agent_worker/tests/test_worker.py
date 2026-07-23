import json
import os
import signal
import unittest

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from blue_whale_agent_worker.contracts import (
    AgentRunConflictError,
    OrchestratorResult,
    RunWork,
    RuntimeCheckpoint,
    StreamAttemptExhaustedError,
)
from blue_whale_agent_worker.pydantic_orchestrator import (
    ACTION_ONLY_RETRY_WITH_BRIDGING_INSTRUCTION,
    PydanticAIOrchestrator,
)
from blue_whale_agent_worker.streaming import emit_text_chunks
from blue_whale_agent_worker.worker import AgentWorker
from test_fake_orchestrator import RecordingRunGateway
from test_pydantic_orchestrator import (
    _bundle_source,
    _pydantic_work,
    image_proposal_model,
    streaming_model,
)


def _fake_work() -> RunWork:
    return RunWork(
        agent_run_id=23,
        project_id=7,
        conversation_id=11,
        user_id=10,
        run_version=1,
        fencing_token=4,
        engine="fake",
        engine_version="1",
        adapter_schema_version=1,
        messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
        checkpoint=None,
    )


def _static_result(visible_text: str = "好的。") -> OrchestratorResult:
    return OrchestratorResult(
        commit_id="static-23-1",
        visible_text=visible_text,
        checkpoint=RuntimeCheckpoint(
            engine="fake",
            engine_version="1",
            adapter_schema_version=1,
            opaque_payload={"step": "static"},
        ),
        actions=(),
    )


class _StaticOrchestrator:
    def __init__(self, result: OrchestratorResult) -> None:
        self._result = result

    async def advance(
        self,
        work: RunWork,
        *,
        stream_id=None,
        emit_chunk=None,
        f1_retry_prior_text=None,
    ) -> OrchestratorResult:
        emit_text_chunks(
            self._result.visible_text,
            work=work,
            stream_id=stream_id or "",
            emit_chunk=emit_chunk,
        )
        return self._result


class _ConflictAtCommitGateway(RecordingRunGateway):
    def commit(self, run_id: int, payload: dict) -> None:
        raise AgentRunConflictError("HTTP 409 AGENT_RUN_CONFLICT")


class _ConflictAtChunkGateway(RecordingRunGateway):
    def append_assistant_message_chunk(self, run_id: int, payload: dict) -> None:
        raise AgentRunConflictError("HTTP 409 AGENT_RUN_CONFLICT")


class WorkerConflictExitTest(unittest.TestCase):
    """IK3BG2：Run 被取代后旧 Worker 收到 409 → 确定性退出（exit 0 + 一条结构化
    warn 日志 + 不再提交任何状态）；其余错误维持崩溃重试。"""

    def test_commit_conflict_exits_normally_with_one_structured_warning(self) -> None:
        gateway = _ConflictAtCommitGateway(_fake_work())

        with self.assertLogs("blue_whale_agent_worker", level="WARNING") as logs:
            # 不抛异常 → 进程自然 exit 0
            AgentWorker(gateway, _StaticOrchestrator(_static_result())).run_once()

        self.assertEqual(
            ["start", "chunk", "complete"],
            [operation[0] for operation in gateway.operations],
        )
        self.assertIsNone(gateway.committed_run_id)
        self.assertEqual(1, len(logs.records))
        record = json.loads(logs.records[0].getMessage())
        self.assertEqual("agent_run_conflict", record["event"])
        self.assertEqual(23, record["agent_run_id"])

    def test_mid_stream_conflict_skips_all_further_writes(self) -> None:
        gateway = _ConflictAtChunkGateway(_fake_work())

        with self.assertLogs("blue_whale_agent_worker", level="WARNING") as logs:
            AgentWorker(gateway, _StaticOrchestrator(_static_result())).run_once()

        # 冲突之后的 chunk/complete/commit 一律不再发生
        self.assertEqual(
            ["start"], [operation[0] for operation in gateway.operations]
        )
        self.assertIsNone(gateway.committed_run_id)
        self.assertEqual(1, len(logs.records))

    def test_other_errors_still_propagate_for_crash_retry(self) -> None:
        class _FailingGateway(RecordingRunGateway):
            def commit(self, run_id: int, payload: dict) -> None:
                raise RuntimeError("Java Product API 返回 HTTP 500")

        gateway = _FailingGateway(_fake_work())
        with self.assertRaises(RuntimeError):
            AgentWorker(gateway, _StaticOrchestrator(_static_result())).run_once()


class WorkerErrorCommitTest(unittest.TestCase):
    """IK3BG2：Worker 失败经 error commit 通道提交，由 Java 落 failed 终态。"""

    def test_orchestrator_failure_is_committed_via_error_channel(self) -> None:
        gateway = RecordingRunGateway(_fake_work())
        failure = OrchestratorResult(
            commit_id="failure-23-1",
            visible_text="编排暂时无法继续。",
            checkpoint=RuntimeCheckpoint(
                engine="fake",
                engine_version="1",
                adapter_schema_version=1,
                opaque_payload={"step": "failed"},
            ),
            actions=(),
            error={"code": "ORCHESTRATION_FAILED", "message": "编排暂时无法继续。"},
        )

        AgentWorker(gateway, _StaticOrchestrator(failure)).run_once()

        self.assertEqual(
            ["start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        self.assertEqual(
            {"code": "ORCHESTRATION_FAILED", "message": "编排暂时无法继续。"},
            gateway.commit_payload["error"],
        )
        self.assertEqual([], gateway.commit_payload["actions"])

    def test_null_bundle_pin_fails_closed_into_error_commit(self) -> None:
        # enforcement-enabled=false 形态（pin 为 null）fail closed：不回退默认提示词或
        # Mock，失败结果经错误 commit 通道提交（Java 侧落 failed 终态由 Java IT 固化）。
        work = _pydantic_work(bundle_version_id=None, manifest_digest=None)
        gateway = RecordingRunGateway(work)
        orchestrator = PydanticAIOrchestrator(
            streaming_model(image_proposal_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            "ORCHESTRATOR_CONTRACT_MISMATCH", gateway.commit_payload["error"]["code"]
        )
        self.assertEqual([], gateway.commit_payload["actions"])
        self.assertIsNone(gateway.commit_payload["user_input_request"])


# F1 混流长文本：64 字符已放行前缀 + 10 字符未放行尾部，前缀与尾部可区分。
MIXED_RELEASED_PREFIX = "放" * 64
MIXED_UNRELEASED_TAIL = "尾" * 10
# F1 空尾部重试轮的过渡说明文本（模型按过渡说明指令附加的简短一句）。
BRIDGING_TRANSITION_TEXT = "好的，马上为您生成。"


def _long_mixed_model(messages, info):
    """混流夹具：输出 74 字符文本 + deferred 动作（前缀满窗、尾部未满窗）；
    纯动作重试轮的文本剥离由 streaming_model 包装器统一承担。"""
    return ModelResponse(
        parts=(
            TextPart(MIXED_RELEASED_PREFIX + MIXED_UNRELEASED_TAIL),
            ToolCallPart(
                "create_image_generation_job",
                {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
                "long-mixed-call-id",
            ),
        )
    )


def _bridging_transition_model(messages, info):
    """空尾部重试轮夹具：首轮恰 64 字符混流（全放行）；收到过渡说明指令时
    返回 过渡 TextPart + deferred 动作（2.9.0 下同响应 output 仍为 str，动作
    由编排层从最后 ModelResponse 显式提取）。"""
    call = ToolCallPart(
        "create_image_generation_job",
        {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
        "bridging-call-id",
    )
    if ACTION_ONLY_RETRY_WITH_BRIDGING_INSTRUCTION in (info.instructions or ""):
        return ModelResponse(parts=(TextPart(BRIDGING_TRANSITION_TEXT), call))
    return ModelResponse(parts=(TextPart(MIXED_RELEASED_PREFIX), call))


def _silent_bridging_model(messages, info):
    """空尾部重试轮夹具：收到过渡说明指令仍零可见文本（只提动作）。"""
    call = ToolCallPart(
        "create_image_generation_job",
        {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
        "silent-bridging-call-id",
    )
    if ACTION_ONLY_RETRY_WITH_BRIDGING_INSTRUCTION in (info.instructions or ""):
        return ModelResponse(parts=(call,))
    return ModelResponse(parts=(TextPart(MIXED_RELEASED_PREFIX), call))


class WorkerStreamAttemptTest(unittest.TestCase):
    """IK3BG3 Worker 尝试编排：F1 混流 abort + 纯动作轮重试、尝试预算（本地计数
    与 Java 100305 权威防线）、F3 取消 / 断连的整流 abort。"""

    def test_f1_mixed_stream_aborts_then_retries_with_fresh_stream_id(self) -> None:
        # 契约 §3.3：混流轮 fail closed——start → abort(PROTOCOL_MIXED_STREAM) →
        # 新 stream_id start → 重放尾部 chunk → complete → commit，动作不丢失。
        # 契约 §3.2：abort 保留已放行前缀（aborted 消息对用户可见），重试轮只
        # 承接未放行尾部（released_sequence_no × 64 截取），不重复重放前缀。
        work = _pydantic_work()
        gateway = RecordingRunGateway(work)
        gateway.abort_response = {"released_sequence_no": 1}  # 前缀 64 字符已放行
        orchestrator = PydanticAIOrchestrator(
            streaming_model(_long_mixed_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            ["start", "chunk", "abort", "start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        first_start, first_chunk, abort, retry_start, retry_chunk, complete = (
            gateway.operations[:6]
        )
        first_stream_id = first_start[2]["stream_id"]
        retry_stream_id = retry_start[2]["stream_id"]
        # F1 重跑必换新 stream_id（契约 §1.2）；重试轮复用同一 ID 收口。
        self.assertNotEqual(first_stream_id, retry_stream_id)
        self.assertEqual(first_stream_id, abort[2]["stream_id"])
        self.assertEqual("PROTOCOL_MIXED_STREAM", abort[2]["reason_code"])
        self.assertEqual(retry_stream_id, retry_chunk[2]["stream_id"])
        self.assertEqual(retry_stream_id, complete[2]["stream_id"])
        self.assertLessEqual(len(abort[2]["idempotency_key"]), 64)
        # 混流轮满窗块即已放行前缀；重试轮只重放未放行尾部（无前缀重复）。
        self.assertEqual(MIXED_RELEASED_PREFIX, first_chunk[2]["content"])
        self.assertEqual(MIXED_UNRELEASED_TAIL, retry_chunk[2]["content"])
        self.assertEqual(1, complete[2]["final_sequence_no"])
        self.assertEqual(MIXED_UNRELEASED_TAIL, gateway.commit_payload["visible_text"])
        self.assertEqual(1, len(gateway.commit_payload["actions"]))
        self.assertEqual(
            retry_stream_id,
            gateway.commit_payload["assistant_message_stream_id"],
        )
        # 工单验收：usage 覆盖所有真实发生的尝试——混流轮 + 重试轮求和。
        usage = gateway.commit_payload["usage"]
        self.assertEqual(2, usage["requests"])
        self.assertEqual(100, usage["input_units"])  # 两轮各 50

    def test_f1_retry_replays_full_text_when_abort_response_lacks_released_seq(self) -> None:
        # 兜底：abort 响应缺 released_sequence_no → 视为 0（未放行任何前缀），
        # 重试轮承接全部已流出文本，保守不丢文本。
        work = _pydantic_work()
        gateway = RecordingRunGateway(work)
        gateway.abort_response = {}  # 缺 released_sequence_no
        orchestrator = PydanticAIOrchestrator(
            streaming_model(image_proposal_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            ["start", "abort", "start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        retry_chunk = gateway.operations[3][2]
        self.assertEqual("好的，为你生成图片。", retry_chunk["content"])
        self.assertEqual("好的，为你生成图片。", gateway.commit_payload["visible_text"])

    def test_f1_retry_start_conflicts_when_abort_undelivered(self) -> None:
        # 兜底：abort 未送达（传输异常）→ 不做尾部推算；遗留活动尝试使重试 start
        # 冲突（409 AGENT_RUN_CONFLICT），走既有确定性退出路径（Java LEASE_TAKEOVER
        # 兜底收口），不再提交任何状态。
        class _AbortFailsGateway(RecordingRunGateway):
            def start_assistant_message(self, run_id: int, payload: dict) -> None:
                if any(op[0] == "abort" for op in self.operations):
                    raise AgentRunConflictError("HTTP 409 AGENT_RUN_CONFLICT")
                super().start_assistant_message(run_id, payload)

            def abort_assistant_message(self, run_id: int, payload: dict) -> None:
                self.operations.append(("abort", run_id, payload))
                raise RuntimeError("connection reset by peer")

        work = _pydantic_work()
        gateway = _AbortFailsGateway(work)
        orchestrator = PydanticAIOrchestrator(
            streaming_model(image_proposal_model), _bundle_source()
        )

        with self.assertLogs("blue_whale_agent_worker", level="WARNING") as logs:
            AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            ["start", "abort"], [operation[0] for operation in gateway.operations]
        )
        self.assertIsNone(gateway.committed_run_id)
        events = [json.loads(r.getMessage())["event"] for r in logs.records]
        self.assertIn("assistant_stream_abort_undelivered", events)
        self.assertIn("agent_run_conflict", events)

    def test_f1_empty_tail_retry_commits_with_bridging_transition_text(self) -> None:
        # 空尾部边界：混流文本恰 64 字符且全部放行（released_sequence_no=1）→
        # 未放行尾部为空——重试轮换用过渡说明指令，模型返回 过渡 TextPart +
        # deferred 动作（同响应 output 为 str，动作从最后 ModelResponse 显式提取），
        # commit 正常闭环：visible_text=过渡说明，动作不丢失。
        work = _pydantic_work()
        gateway = RecordingRunGateway(work)
        gateway.abort_response = {"released_sequence_no": 1}  # 全文已放行
        orchestrator = PydanticAIOrchestrator(
            streaming_model(_bridging_transition_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            ["start", "chunk", "abort", "start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        retry_chunk = gateway.operations[4][2]
        complete = gateway.operations[5][2]
        self.assertEqual(BRIDGING_TRANSITION_TEXT, retry_chunk["content"])
        self.assertEqual(1, complete["final_sequence_no"])
        self.assertEqual(BRIDGING_TRANSITION_TEXT, gateway.commit_payload["visible_text"])
        self.assertEqual(1, len(gateway.commit_payload["actions"]))
        self.assertIsNone(gateway.commit_payload["error"])
        # 过渡说明不重复已放行前缀（用户不会看到正文重复）。
        self.assertNotIn(MIXED_RELEASED_PREFIX, retry_chunk["content"])

    def test_f1_empty_tail_retry_without_any_text_fails_closed(self) -> None:
        # 兜底：空尾部且模型连过渡说明都不给 → 维持 fail closed，规范化
        # ORCHESTRATOR_CONTRACT_MISMATCH 失败收场（边缘的边缘，不提交动作）。
        work = _pydantic_work()
        gateway = RecordingRunGateway(work)
        gateway.abort_response = {"released_sequence_no": 1}
        orchestrator = PydanticAIOrchestrator(
            streaming_model(_silent_bridging_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            ["start", "chunk", "abort", "start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        self.assertEqual(
            "ORCHESTRATOR_CONTRACT_MISMATCH",
            gateway.commit_payload["error"]["code"],
        )
        self.assertEqual([], gateway.commit_payload["actions"])

    def test_second_mixed_round_exhausts_budget_without_third_model_call(self) -> None:
        # 契约 §2.1：F1/F3 共用 2 次尝试预算——重试轮仍混流 → 不再调用模型，
        # 无第三次 start，走规范化 error commit（ADR-0043）使 Run 进入 failed。
        calls = []

        async def stubborn_stream(messages, info):
            calls.append(True)
            yield "仍然混流的文本。"
            yield {
                0: DeltaToolCall(
                    name="create_image_generation_job",
                    json_args='{"prompt": "蓝鲸"}',
                    tool_call_id="stubborn-call",
                )
            }

        work = _pydantic_work()
        gateway = RecordingRunGateway(work)
        orchestrator = PydanticAIOrchestrator(
            FunctionModel(stream_function=stubborn_stream), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(2, len(calls))  # 本地计数最多 2 次模型调用
        self.assertEqual(
            ["start", "abort", "start", "abort", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        aborts = [op for op in gateway.operations if op[0] == "abort"]
        self.assertTrue(
            all(op[2]["reason_code"] == "PROTOCOL_MIXED_STREAM" for op in aborts)
        )
        self.assertEqual(
            "ASSISTANT_STREAM_ATTEMPT_EXHAUSTED",
            gateway.commit_payload["error"]["code"],
        )
        self.assertEqual([], gateway.commit_payload["actions"])
        self.assertNotIn("assistant_message_stream_id", gateway.commit_payload)
        # 工单验收：失败收场的 usage 仍覆盖两个真实发生的混流尝试。
        self.assertEqual(2, gateway.commit_payload["usage"]["requests"])

    def test_java_attempt_quota_exhausted_commits_error_without_model_call(self) -> None:
        # 契约 §2.3：跨进程恢复时 Java 的权威防线（409 + 100305）——Worker 收到后
        # 不再调用模型，直接规范化 error commit。
        class _ExhaustedAtStartGateway(RecordingRunGateway):
            def start_assistant_message(self, run_id: int, payload: dict) -> None:
                raise StreamAttemptExhaustedError(
                    "HTTP 409 ASSISTANT_STREAM_ATTEMPT_EXHAUSTED"
                )

        class _CountingOrchestrator:
            def __init__(self) -> None:
                self.calls = 0

            async def advance(self, work, **kwargs) -> OrchestratorResult:
                self.calls += 1
                return _static_result()

        work = _fake_work()
        gateway = _ExhaustedAtStartGateway(work)
        orchestrator = _CountingOrchestrator()

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(0, orchestrator.calls)  # 不得再次调用模型
        self.assertEqual(
            ["commit"], [operation[0] for operation in gateway.operations]
        )
        self.assertEqual(
            "ASSISTANT_STREAM_ATTEMPT_EXHAUSTED",
            gateway.commit_payload["error"]["code"],
        )
        self.assertNotIn("assistant_message_stream_id", gateway.commit_payload)

    def test_sigterm_mid_stream_aborts_with_cancelled_before_exit(self) -> None:
        # F3（契约 §3.3）：流进行中收到 SIGTERM → 先幂等 abort（CANCELLED）
        # 再退出（一条结构化 warn 日志，不再 complete / commit）。
        class _TerminatingGateway(RecordingRunGateway):
            def append_assistant_message_chunk(self, run_id: int, payload: dict) -> None:
                os.kill(os.getpid(), signal.SIGTERM)

        work = _fake_work()
        gateway = _TerminatingGateway(work)
        long_text = "取" * 100  # 触发流式期间的 chunk 回调
        with self.assertLogs("blue_whale_agent_worker", level="WARNING") as logs:
            # 不抛异常 → 进程自然 exit 0
            AgentWorker(gateway, _StaticOrchestrator(_static_result(long_text))).run_once()

        self.assertEqual(
            ["start", "abort"], [operation[0] for operation in gateway.operations]
        )
        abort = gateway.operations[1][2]
        self.assertEqual("CANCELLED", abort["reason_code"])
        self.assertLessEqual(len(abort["idempotency_key"]), 64)
        record = json.loads(logs.records[0].getMessage())
        self.assertEqual("agent_run_stream_interrupted", record["event"])

    def test_disconnect_mid_stream_aborts_best_effort_then_raises(self) -> None:
        # F3（契约 §3.3/§4）：流式期间 gateway 传输错误 → best-effort abort
        # （DISCONNECT）后原样抛出，维持崩溃重试语义；abort 未送达由 Java
        # LEASE_TAKEOVER 兜底。
        class _DisconnectAtChunkGateway(RecordingRunGateway):
            def append_assistant_message_chunk(self, run_id: int, payload: dict) -> None:
                raise RuntimeError("connection reset by peer")

        work = _fake_work()
        gateway = _DisconnectAtChunkGateway(work)
        long_text = "断" * 100
        with self.assertRaises(RuntimeError):
            AgentWorker(gateway, _StaticOrchestrator(_static_result(long_text))).run_once()

        self.assertEqual(
            ["start", "abort"], [operation[0] for operation in gateway.operations]
        )
        self.assertEqual(
            "DISCONNECT", gateway.operations[1][2]["reason_code"]
        )


if __name__ == "__main__":
    unittest.main()
