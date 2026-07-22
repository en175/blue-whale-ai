from pydantic_ai.models import Model

from .bundle.cache import CachingBundleSource, default_cache_dir
from .bundle.source import BundleSource
from .contracts import ConversationSource, CreativeContextSource, OrchestratorPort
from .fake_orchestrator import FakeOrchestrator
from .pydantic_orchestrator import PydanticAIOrchestrator


def create_orchestrator(
    adapter: str,
    model: Model | str | None = None,
    bundle_source: BundleSource | None = None,
    conversation_source: ConversationSource | None = None,
    creative_context_source: CreativeContextSource | None = None,
) -> OrchestratorPort:
    if adapter == "fake":
        return FakeOrchestrator()
    if adapter == "pydantic-ai":
        if model is None:
            raise ValueError("pydantic-ai Adapter 需要显式模型配置")
        if bundle_source is None:
            raise ValueError("pydantic-ai Adapter 需要 BundleSource")
        # 内容寻址磁盘缓存装饰层（IK2QBP）：同内容同版本只拉一次，进程重启后命中本地缓存。
        # Verifier / ContextLoader / ResourceGate 均不感知缓存存在（契约不变）。
        caching_source = CachingBundleSource(bundle_source, default_cache_dir())
        return PydanticAIOrchestrator(
            model,
            caching_source,
            conversation_source=conversation_source,
            creative_context_source=creative_context_source,
        )
    raise ValueError(f"未知编排 Adapter: {adapter}")
