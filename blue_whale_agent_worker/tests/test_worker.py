import json
import unittest

from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.contracts import (
    OrchestratorResult,
    RunWork,
    RuntimeCheckpoint,
)
from blue_whale_agent_worker.http_gateway import AgentRunConflictError
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator
from blue_whale_agent_worker.worker import AgentWorker
from test_fake_orchestrator import RecordingRunGateway
from test_pydantic_orchestrator import (
    _bundle_source,
    _pydantic_work,
    image_proposal_model,
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

    def advance(self, work: RunWork) -> OrchestratorResult:
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
            FunctionModel(image_proposal_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(
            "ORCHESTRATOR_CONTRACT_MISMATCH", gateway.commit_payload["error"]["code"]
        )
        self.assertEqual([], gateway.commit_payload["actions"])
        self.assertIsNone(gateway.commit_payload["user_input_request"])


if __name__ == "__main__":
    unittest.main()
