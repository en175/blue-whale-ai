import hashlib
import json
import unittest

from blue_whale_agent_worker.contracts import (
    OrchestratorResult,
    RunWork,
    RuntimeCheckpoint,
)
from blue_whale_agent_worker.fake_orchestrator import FakeOrchestrator
from blue_whale_agent_worker.worker import AgentWorker


class RecordingRunGateway:
    def __init__(self, work: RunWork) -> None:
        self.work = work
        self.committed_run_id = None
        self.commit_payload = None
        self.operations = []

    def claim(self) -> RunWork:
        return self.work

    def commit(self, run_id: int, payload: dict[str, object]) -> None:
        self.operations.append(("commit", run_id, payload))
        self.committed_run_id = run_id
        self.commit_payload = payload

    def start_assistant_message(
        self, run_id: int, payload: dict[str, object]
    ) -> None:
        self.operations.append(("start", run_id, payload))

    def append_assistant_message_chunk(
        self, run_id: int, payload: dict[str, object]
    ) -> None:
        self.operations.append(("chunk", run_id, payload))

    def complete_assistant_message(
        self, run_id: int, payload: dict[str, object]
    ) -> None:
        self.operations.append(("complete", run_id, payload))


class _StaticTextOrchestrator:
    """返回定长可见文本的编排器桩：驱动 worker 的多块切分路径。"""

    def __init__(self, visible_text: str) -> None:
        self._visible_text = visible_text

    def advance(self, work: RunWork) -> OrchestratorResult:
        return OrchestratorResult(
            commit_id=f"static-{work.agent_run_id}-{work.run_version}",
            visible_text=self._visible_text,
            checkpoint=RuntimeCheckpoint(
                engine=work.engine,
                engine_version=work.engine_version,
                adapter_schema_version=work.adapter_schema_version,
                opaque_payload={"step": "static"},
            ),
            actions=(),
        )


class FakeOrchestratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.work = RunWork(
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

    def test_fake_result_serializes_only_product_neutral_contract(self) -> None:
        result = FakeOrchestrator().advance(self.work)
        payload = result.to_commit_payload(self.work)

        self.assertEqual("create_image_generation_job", payload["actions"][0]["tool_id"])
        self.assertEqual("蓝鲸海报", payload["actions"][0]["arguments"]["prompt"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("pydantic", serialized.lower())
        self.assertNotIn("runcontext", serialized.lower())
        self.assertNotIn("agentnode", serialized.lower())

    def test_worker_advances_claimed_run_through_the_port(self) -> None:
        gateway = RecordingRunGateway(self.work)

        AgentWorker(gateway, FakeOrchestrator()).run_once()

        self.assertEqual(23, gateway.committed_run_id)
        self.assertEqual(7, gateway.commit_payload["project_id"])
        self.assertEqual(4, gateway.commit_payload["fencing_token"])
        self.assertEqual("fake", gateway.commit_payload["engine"])
        self.assertEqual(
            ["start", "chunk", "complete", "commit"],
            [operation[0] for operation in gateway.operations],
        )
        start_payload = gateway.operations[0][2]
        chunk_payload = gateway.operations[1][2]
        complete_payload = gateway.operations[2][2]
        stream_id = start_payload["stream_id"]
        self.assertEqual(stream_id, chunk_payload["stream_id"])
        self.assertEqual(stream_id, complete_payload["stream_id"])
        self.assertEqual(stream_id, gateway.commit_payload["assistant_message_stream_id"])
        self.assertEqual(1, chunk_payload["sequence_no"])
        self.assertEqual(
            "已接纳，正在生成图片。", chunk_payload["content"]
        )
        self.assertEqual(
            "local-fake" if self.work.engine == "fake" else "worker-prefix",
            chunk_payload["review_evidence"]["source"],
        )
        self.assertTrue(
            all(
                len(operation[2]["idempotency_key"]) <= 64
                for operation in gateway.operations[:3]
            )
        )
        self.assertEqual(64, len(complete_payload["content_digest"]))

    def test_worker_splits_long_visible_text_into_sequenced_chunks(self) -> None:
        # 160 字符 > TEXT_CHUNK_SIZE(64)：切 3 块，逐块审核放行，complete 按全文封口。
        long_text = "分段" * 80
        gateway = RecordingRunGateway(self.work)

        AgentWorker(gateway, _StaticTextOrchestrator(long_text)).run_once()

        chunk_payloads = [
            operation[2] for operation in gateway.operations
            if operation[0] == "chunk"
        ]
        self.assertEqual(3, len(chunk_payloads))
        self.assertEqual(
            [1, 2, 3], [payload["sequence_no"] for payload in chunk_payloads]
        )
        self.assertEqual(
            long_text, "".join(payload["content"] for payload in chunk_payloads)
        )
        self.assertEqual(
            3, len({payload["idempotency_key"] for payload in chunk_payloads})
        )
        complete_payload = [
            operation[2] for operation in gateway.operations
            if operation[0] == "complete"
        ][0]
        self.assertEqual(3, complete_payload["final_sequence_no"])
        self.assertEqual(
            hashlib.sha256(long_text.encode("utf-8")).hexdigest(),
            complete_payload["content_digest"],
        )

    def test_chunk_identity_survives_lease_reclaim_for_long_text(self) -> None:
        long_text = "重放" * 80
        first_gateway = RecordingRunGateway(self.work)
        reclaimed_gateway = RecordingRunGateway(
            RunWork(**{**self.work.__dict__, "run_version": 2, "fencing_token": 5})
        )

        AgentWorker(first_gateway, _StaticTextOrchestrator(long_text)).run_once()
        AgentWorker(reclaimed_gateway, _StaticTextOrchestrator(long_text)).run_once()

        self.assertEqual(
            [
                (operation[0], operation[2].get("idempotency_key"))
                for operation in first_gateway.operations
            ],
            [
                (operation[0], operation[2].get("idempotency_key"))
                for operation in reclaimed_gateway.operations
            ],
        )

    def test_stream_identity_survives_lease_reclaim_with_a_new_run_version(self) -> None:
        first_gateway = RecordingRunGateway(self.work)
        reclaimed_gateway = RecordingRunGateway(
            RunWork(**{**self.work.__dict__, "run_version": 2, "fencing_token": 5})
        )

        AgentWorker(first_gateway, FakeOrchestrator()).run_once()
        AgentWorker(reclaimed_gateway, FakeOrchestrator()).run_once()

        for operation_index in range(3):
            first_payload = first_gateway.operations[operation_index][2]
            reclaimed_payload = reclaimed_gateway.operations[operation_index][2]
            self.assertEqual(first_payload["stream_id"], reclaimed_payload["stream_id"])
            self.assertEqual(
                first_payload["idempotency_key"],
                reclaimed_payload["idempotency_key"],
            )

    def test_fake_refuses_a_production_engine_run(self) -> None:
        production_work = RunWork(
            **{**self.work.__dict__, "engine": "pydantic-ai"}
        )

        with self.assertRaisesRegex(ValueError, "engine=fake"):
            FakeOrchestrator().advance(production_work)

    def test_clarification_proposal_serializes_only_product_neutral_fields(self) -> None:
        clarification_work = RunWork(
            **{
                **self.work.__dict__,
                "messages": ({"role": "user", "content": "澄清:蓝鲸海报"},),
            }
        )
        result = FakeOrchestrator().advance(clarification_work)
        payload = result.to_commit_payload(clarification_work)

        # 创作澄清与动作互斥：payload 不携带 actions，只携带 user_input_request 提议。
        self.assertEqual([], payload["actions"])
        proposal = payload["user_input_request"]
        self.assertEqual("creation_clarification", proposal["request_type"])
        self.assertIn("蓝鲸海报", proposal["question"])
        # 产品中性：不泄漏框架内部或供应商私有字段。
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("pydantic", serialized.lower())
        self.assertNotIn("provider", serialized.lower())
        self.assertNotIn("deferredtool", serialized.lower())

    def test_clarification_proposal_is_mutually_exclusive_with_actions(self) -> None:
        clarification_work = RunWork(
            **{
                **self.work.__dict__,
                "messages": ({"role": "user", "content": "澄清:蓝鲸海报"},),
            }
        )
        result = FakeOrchestrator().advance(clarification_work)

        self.assertEqual((), result.actions)
        self.assertIsNotNone(result.input_request)

    def test_incomplete_intent_proposes_clarification_without_manual_prefix(self) -> None:
        # 意图缺少推进生图所必需的信息（剥掉「生成一张」后无实质内容）：
        # 确定性地只提出一个创作澄清请求，不提出动作。
        incomplete_work = RunWork(
            **{
                **self.work.__dict__,
                "messages": ({"role": "user", "content": "生成一张"},),
            }
        )
        result = FakeOrchestrator().advance(incomplete_work)
        payload = result.to_commit_payload(incomplete_work)

        self.assertEqual((), result.actions)
        self.assertIsNotNone(result.input_request)
        self.assertEqual(
            "creation_clarification", payload["user_input_request"]["request_type"]
        )
        self.assertEqual([], payload["actions"])
        self.assertEqual(
            "clarification_proposed", result.checkpoint.opaque_payload["step"]
        )

    def test_resume_after_clarification_merges_original_intent_and_answer(self) -> None:
        # 恢复工作包：checkpoint 存有首轮原始创作意图，最新消息是用户的自然语言回答。
        # 恢复后恰好一个 generate_image 动作，参数同时保留两者形成的约束。
        checkpoint = RuntimeCheckpoint(
            engine="fake",
            engine_version="1",
            adapter_schema_version=1,
            opaque_payload={"step": "clarification_proposed", "topic": "蓝鲸海报"},
        )
        resumed_work = RunWork(
            **{
                **self.work.__dict__,
                "run_version": 2,
                "messages": (
                    {"role": "user", "content": "生成一张蓝鲸海报"},
                    {"role": "assistant", "content": "请补充你希望生成的「蓝鲸海报」的具体风格或细节。"},
                    {"role": "user", "content": "水墨风格带留白"},
                ),
                "checkpoint": checkpoint,
            }
        )
        result = FakeOrchestrator().advance(resumed_work)

        self.assertIsNone(result.input_request)
        self.assertEqual(1, len(result.actions))
        action = result.actions[0]
        self.assertEqual("create_image_generation_job", action.tool_id)
        prompt = action.arguments["prompt"]
        self.assertIn("蓝鲸海报", prompt)
        self.assertIn("水墨风格带留白", prompt)

    def test_resume_rejects_checkpoint_with_mismatched_engine_identity(self) -> None:
        checkpoint = RuntimeCheckpoint(
            engine="fake",
            engine_version="0.9",
            adapter_schema_version=7,
            opaque_payload={"step": "clarification_proposed", "topic": "蓝鲸海报"},
        )
        resumed_work = RunWork(**{**self.work.__dict__, "checkpoint": checkpoint})

        with self.assertRaisesRegex(ValueError, "不匹配"):
            FakeOrchestrator().advance(resumed_work)


if __name__ == "__main__":
    unittest.main()
