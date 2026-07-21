import os
import unittest
from importlib.metadata import version
from typing import Any

from blue_whale_agent_worker.contracts import RunWork
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator
from blue_whale_agent_worker.worker import AgentWorker


SMOKE_MODEL = os.getenv("BLUE_WHALE_LLM_SMOKE_MODEL")


class RecordingRunGateway:
    def __init__(self, work: RunWork) -> None:
        self.work = work
        self.committed_run_id: int | None = None
        self.commit_payload: dict[str, Any] | None = None

    def claim(self) -> RunWork:
        return self.work

    def commit(self, run_id: int, payload: dict[str, Any]) -> None:
        self.committed_run_id = run_id
        self.commit_payload = payload

    def start_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        pass

    def append_assistant_message_chunk(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        pass

    def complete_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        pass


class PydanticAILiveSmokeTest(unittest.TestCase):
    @unittest.skipUnless(
        SMOKE_MODEL,
        "设置 BLUE_WHALE_LLM_SMOKE_MODEL 后才执行真实 LLM 烟测",
    )
    def test_configured_model_proposes_one_product_neutral_image_action(self) -> None:
        assert SMOKE_MODEL is not None
        self.assertEqual("2.9.0", version("pydantic-ai-slim"))
        work = RunWork(
            agent_run_id=1,
            project_id=1,
            conversation_id=1,
            user_id=1,
            run_version=1,
            fencing_token=1,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )

        gateway = RecordingRunGateway(work)
        AgentWorker(gateway, PydanticAIOrchestrator(SMOKE_MODEL)).run_once()

        self.assertEqual(work.agent_run_id, gateway.committed_run_id)
        commit_payload = gateway.commit_payload
        assert commit_payload is not None
        self.assertEqual("已接纳，正在生成图片。", commit_payload["visible_text"])
        self.assertEqual(1, len(commit_payload["actions"]))
        self.assertEqual(
            "generate_image", commit_payload["actions"][0]["action_type"]
        )
        print(
            f"LLM smoke evidence: model={SMOKE_MODEL}, "
            f"pydantic-ai-slim={version('pydantic-ai-slim')}"
        )


if __name__ == "__main__":
    unittest.main()
