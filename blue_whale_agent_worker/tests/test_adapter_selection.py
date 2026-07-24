import unittest

from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.adapters import create_orchestrator
from blue_whale_agent_worker.fake_orchestrator import FakeOrchestrator
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator
from test_pydantic_orchestrator import (
    _bundle_source,
    image_proposal_model,
)


class AdapterSelectionTest(unittest.TestCase):
    def test_fake_is_only_selected_explicitly(self) -> None:
        self.assertIsInstance(create_orchestrator("fake"), FakeOrchestrator)

    def test_fixed_production_adapter_requires_an_injected_model(self) -> None:
        orchestrator = create_orchestrator(
            "pydantic-ai", FunctionModel(image_proposal_model), _bundle_source()
        )

        self.assertIsInstance(orchestrator, PydanticAIOrchestrator)

    def test_creative_content_source_is_wired_into_pydantic_adapter(self) -> None:
        # IK3NPD：create_orchestrator 必须把 creative_content_source 透传给 PydanticAIOrchestrator，
        # 否则生产入口（__main__ → gateway）下 forced 激活正文永不进入 Agent 上下文（spec 硬要求）。
        class _Probe:
            def fetch_creative_skill_body(self, run_id):
                raise AssertionError("构造期不应读取正文")

            def fetch_creative_skill_reference(self, run_id, resource_path):
                raise AssertionError("构造期不应读取引用资源")

        probe = _Probe()
        orchestrator = create_orchestrator(
            "pydantic-ai", FunctionModel(image_proposal_model), _bundle_source(),
            creative_content_source=probe,
        )
        self.assertIsInstance(orchestrator, PydanticAIOrchestrator)
        self.assertIs(probe, orchestrator._creative_content_source)

    def test_unknown_adapter_never_falls_back_to_fake(self) -> None:
        with self.assertRaisesRegex(ValueError, "未知编排 Adapter"):
            create_orchestrator("pydantic-ai-typo")

        with self.assertRaisesRegex(ValueError, "模型配置"):
            create_orchestrator("pydantic-ai")


if __name__ == "__main__":
    unittest.main()
