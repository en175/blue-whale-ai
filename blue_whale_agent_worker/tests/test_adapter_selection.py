import unittest

from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.adapters import create_orchestrator
from blue_whale_agent_worker.fake_orchestrator import FakeOrchestrator
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator
from test_pydantic_orchestrator import (
    image_proposal_model,
)


class AdapterSelectionTest(unittest.TestCase):
    def test_fake_is_only_selected_explicitly(self) -> None:
        self.assertIsInstance(create_orchestrator("fake"), FakeOrchestrator)

    def test_fixed_production_adapter_requires_an_injected_model(self) -> None:
        orchestrator = create_orchestrator(
            "pydantic-ai", FunctionModel(image_proposal_model)
        )

        self.assertIsInstance(orchestrator, PydanticAIOrchestrator)

    def test_unknown_adapter_never_falls_back_to_fake(self) -> None:
        with self.assertRaisesRegex(ValueError, "未知编排 Adapter"):
            create_orchestrator("pydantic-ai-typo")

        with self.assertRaisesRegex(ValueError, "模型配置"):
            create_orchestrator("pydantic-ai")


if __name__ == "__main__":
    unittest.main()
