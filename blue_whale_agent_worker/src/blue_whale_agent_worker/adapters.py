from pydantic_ai.models import Model

from .bundle.source import BundleSource
from .contracts import OrchestratorPort
from .fake_orchestrator import FakeOrchestrator
from .pydantic_orchestrator import PydanticAIOrchestrator


def create_orchestrator(
    adapter: str,
    model: Model | str | None = None,
    bundle_source: BundleSource | None = None,
) -> OrchestratorPort:
    if adapter == "fake":
        return FakeOrchestrator()
    if adapter == "pydantic-ai":
        if model is None:
            raise ValueError("pydantic-ai Adapter 需要显式模型配置")
        if bundle_source is None:
            raise ValueError("pydantic-ai Adapter 需要 BundleSource")
        return PydanticAIOrchestrator(model, bundle_source)
    raise ValueError(f"未知编排 Adapter: {adapter}")
