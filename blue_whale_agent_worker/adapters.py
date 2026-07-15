from pydantic_ai.models import Model

from .contracts import OrchestratorPort
from .fake_orchestrator import FakeOrchestrator
from .pydantic_orchestrator import PydanticAIOrchestrator


def create_orchestrator(
    adapter: str, model: Model | str | None = None
) -> OrchestratorPort:
    if adapter == "fake":
        return FakeOrchestrator()
    if adapter == "pydantic-ai":
        if model is None:
            raise ValueError("pydantic-ai Adapter 需要显式模型配置")
        return PydanticAIOrchestrator(model)
    raise ValueError(f"未知编排 Adapter: {adapter}")
