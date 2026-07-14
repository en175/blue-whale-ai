import json
import unittest

from blue_whale_agent_worker.contracts import RunWork
from blue_whale_agent_worker.fake_orchestrator import FakeOrchestrator
from blue_whale_agent_worker.worker import AgentWorker


class RecordingRunGateway:
    def __init__(self, work: RunWork) -> None:
        self.work = work
        self.committed_run_id = None
        self.commit_payload = None

    def claim(self) -> RunWork:
        return self.work

    def commit(self, run_id: int, payload: dict[str, object]) -> None:
        self.committed_run_id = run_id
        self.commit_payload = payload


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

        self.assertEqual("generate_image", payload["actions"][0]["action_type"])
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

    def test_fake_refuses_a_production_engine_run(self) -> None:
        production_work = RunWork(
            **{**self.work.__dict__, "engine": "pydantic-ai"}
        )

        with self.assertRaisesRegex(ValueError, "engine=fake"):
            FakeOrchestrator().advance(production_work)


if __name__ == "__main__":
    unittest.main()
