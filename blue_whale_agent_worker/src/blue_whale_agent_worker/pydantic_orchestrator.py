from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping

from pydantic_ai import (
    Agent,
    CallDeferred,
    DeferredToolRequests,
    DeferredToolResults,
    RunContext,
)
from pydantic_ai.messages import ModelMessagesTypeAdapter, ToolCallPart
from pydantic_ai.models import Model

from .bundle.errors import BundleError
from .bundle.gate import ReadEvidence, ResourceGate
from .bundle.loader import ContextLoader, LoadedContext
from .bundle.source import BundleSource
from .bundle.verifier import BundleVerifier, VerifiedSnapshot
from .contracts import (
    OrchestratorResult,
    ProposedAction,
    RunWork,
    RuntimeCheckpoint,
    UserInputRequestProposal,
)


ENGINE = "pydantic-ai"
ENGINE_VERSION = "2.9.0"
ADAPTER_SCHEMA_VERSION = 1

# checkpoint pending_calls 项的 kind 标记：澄清 deferred call 恢复时用用户自然语言
# 回答作 ToolResult 回喂，区别于动作 pending（结果来自 accepted_results）。
_CLARIFICATION_PENDING_KIND = "clarification"

ImageAspectRatio = Literal["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "21:9"]


class _ContractError(Exception):
    pass


def generate_image(
    prompt: str,
    aspect_ratio: ImageAspectRatio = "1:1",
    reference_asset_ids: list[int] | None = None,
    size: str | None = None,
    web_search: bool | None = None,
) -> str:
    """Propose an image action for the Java product control plane to accept.

    size 与 web_search 可选：缺省由产品控制平面按模型能力表兜底；模型固定走能力表
    默认项，Agent 不暴露模型选择。
    """
    raise CallDeferred


def request_user_input(
    request_type: Literal["creation_clarification"],
    question: str,
    resume_binding: dict[str, Any] | None = None,
) -> str:
    """Propose a product-neutral input request (creation clarification) for the user.

    显式副作用工具（IK2QBY）：Agent 缺少推进创作所必需的信息时，向用户提出一个可见问题
    并等待自然语言回答。仍走 ADR-0036 的 UserInputRequestProposal 通道，不新建请求端点；
    resume_binding 为不透明产品事实，回传给来源 AgentRun 用于多轮恢复。
    """
    raise CallDeferred


def read_resource(ctx: RunContext[ResourceGate], resource_id: str) -> str:
    """按发布快照固化的 resourceId 读取 on_demand 资源正文（受限、记账）。

    Bundle 固有受限读取工具，独立于当次 ToolGrant（业务动作工具）：每个有 Bundle pin
    的 Run 总注入，由 ResourceGate 做 digest 比对与双预算门，运行时不做路径 / 网络 /
    跨 Bundle 寻址。
    """
    return ctx.deps.read(resource_id)


@dataclass(frozen=True)
class ToolImplementation:
    """Python 侧工具实现注册项：tool_name 对应的 handler 与平台注册表元数据。

    handler 是 pydantic-ai 工具函数：副作用工具函数体 raise CallDeferred（deferred 注册），
    只读工具函数体直接返回结果（直接工具注册）。pydantic-ai 据函数签名生成模型可见 schema，
    函数名即工具名。registry_version / effect 与平台 ToolRegistry 对齐，用于校验当次 grant。
    """

    tool_name: str
    tool_id: str
    registry_version: int
    effect: Literal["read", "side_effect"]
    handler: Callable[..., object]


def _default_tool_implementations() -> Mapping[str, ToolImplementation]:
    """生产默认工具实现目录：图片生成与请求用户输入（均 side_effect / deferred）。

    request_user_input 把创作澄清从隐式文本分支升级为显式副作用工具（IK2QBY）；
    只读工具的实际读取实现属后续子工单，本目录先落框架，按 grant 动态装配机制通用支持。
    """

    return {
        "generate_image": ToolImplementation(
            "generate_image", "create_image_generation_job", 1, "side_effect", generate_image
        ),
        "request_user_input": ToolImplementation(
            "request_user_input", "request_user_input", 1, "side_effect", request_user_input
        ),
    }


class PydanticAIOrchestrator:
    def __init__(
        self,
        model: Model | str,
        bundle_source: BundleSource,
        implementations: Mapping[str, ToolImplementation] | None = None,
    ) -> None:
        self._model = model
        self._bundle_source = bundle_source
        self._implementations = (
            implementations
            if implementations is not None
            else _default_tool_implementations()
        )

    def advance(self, work: RunWork) -> OrchestratorResult:
        try:
            return self._advance(work)
        except BundleError as exc:
            return self._failure(work, exc.code, exc.message)
        except _ContractError:
            return self._failure(work, "ORCHESTRATOR_CONTRACT_MISMATCH")
        except Exception:
            return self._failure(work, "ORCHESTRATION_FAILED")

    def _load_bundle(
        self, work: RunWork
    ) -> tuple[VerifiedSnapshot, LoadedContext]:
        # 生产路径：按 AgentRun 固定的 BundleVersion 拉取并校验快照，装载基础上下文
        # 产出 instructions + 活动基线 token + initial 读取证据（契约 §6）。pin 缺失
        # （enforcement-enabled=false 的测试环境）视为配置错误 fail closed，不回退硬编码提示词。
        if (
            not work.bundle_version_id
            or not work.manifest_digest
            or not work.model_profile_id
            or not work.model_profile_version
        ):
            raise _ContractError("AgentRun 缺少 Runtime Bundle / ModelProfile pin")
        verified = BundleVerifier(self._bundle_source).verify(
            work.bundle_version_id, work.manifest_digest
        )
        loaded = ContextLoader(self._bundle_source).load(
            verified, work.model_profile_id, work.model_profile_version
        )
        return verified, loaded

    def _advance(self, work: RunWork) -> OrchestratorResult:
        self._validate_identity(work)
        verified, loaded = self._load_bundle(work)
        # 受限资源读取闸门：持有校验通过的快照与基础上下文基线，承接 on_demand 读取、
        # 双预算门、digest 比对与 ReadEvidence 记账（契约 §6 第 3 条 / IK2QBM）。
        gate = ResourceGate(
            verified,
            self._bundle_source,
            initial_tokens=loaded.initial_tokens,
            initial_evidence=loaded.initial_evidence,
        )
        agent = Agent(
            self._model,
            output_type=(str, DeferredToolRequests),
            instructions=loaded.instructions,
            tools=(*self._build_tools(work), read_resource),
            deps_type=ResourceGate,
        )
        if work.checkpoint is None:
            prompt = next(
                message["content"]
                for message in reversed(work.messages)
                if message["role"] == "user"
            )
            run_result = agent.run_sync(prompt, deps=gate)
        else:
            self._validate_checkpoint(work)
            payload = work.checkpoint.opaque_payload
            messages = ModelMessagesTypeAdapter.validate_python(payload["messages"])
            # 已读账本不从 checkpoint 复制（契约 §6：checkpoint 不嵌 Bundle 内容），
            # 而是从消息历史中的 read_resource 调用确定性地重建，重建后仍受 active 门约束。
            self._replay_read_resource(messages, gate)
            restored_calls = payload["pending_calls"]
            if restored_calls:
                # 恢复闭合 checkpoint 消息历史中的 deferred ToolCallPart：动作 pending 的
                # 结果来自 accepted_results，澄清 pending 的结果来自用户最新自然语言回答
                # （request_user_input 的 ToolReturn 即用户回答，IK2QBY 多轮澄清）。
                results_by_action = {
                    result.action_id: result for result in work.accepted_results
                }
                action_pending = [
                    pending for pending in restored_calls
                    if pending.get("kind") != _CLARIFICATION_PENDING_KIND
                ]
                if {pending["action_id"] for pending in action_pending} != set(results_by_action):
                    raise _ContractError("已接纳结果与 checkpoint 中的待处理动作不匹配")
                deferred_calls: dict[str, Mapping[str, Any]] = {}
                for pending in action_pending:
                    result = results_by_action[pending["action_id"]]
                    deferred_calls[pending["tool_call_id"]] = {
                        "status": result.status,
                        "result": dict(result.result),
                    }
                clarify_pending = [
                    pending for pending in restored_calls
                    if pending.get("kind") == _CLARIFICATION_PENDING_KIND
                ]
                if clarify_pending:
                    answer = next(
                        message["content"]
                        for message in reversed(work.messages)
                        if message["role"] == "user"
                    )
                    for pending in clarify_pending:
                        deferred_calls[pending["tool_call_id"]] = {
                            "status": "answered",
                            "result": {"answer": answer},
                        }
                run_result = agent.run_sync(
                    message_history=messages,
                    deferred_tool_results=DeferredToolResults(calls=deferred_calls),
                    deps=gate,
                )
            else:
                # 无 pending 恢复：checkpoint 消息历史 + 最新用户消息继续自然对话。
                answer = next(
                    message["content"]
                    for message in reversed(work.messages)
                    if message["role"] == "user"
                )
                run_result = agent.run_sync(answer, message_history=messages, deps=gate)

        actions: tuple[ProposedAction, ...] = ()
        pending_calls: tuple[dict[str, str], ...] = ()
        input_request: UserInputRequestProposal | None = None
        if isinstance(run_result.output, DeferredToolRequests):
            requests = run_result.output
            if len(requests.calls) != 1:
                raise _ContractError("模型必须且只能提出一个外部动作或输入请求")
            call = requests.calls[0]
            authorized_side_effects = {
                grant.tool_name for grant in work.tool_grants if grant.effect == "side_effect"
            }
            if call.tool_name not in authorized_side_effects:
                raise _ContractError("模型提出了不在当次授权集合内的工具动作")
            action_id = f"pydantic-{call.tool_name}-{work.agent_run_id}-{work.run_version}"
            if call.tool_name == "request_user_input":
                # 显式澄清工具（IK2QBY）：参数映射 UserInputRequestProposal，仍走 ADR-0036
                # 通道。挂 clarification pending——恢复时把用户自然语言回答作为该 deferred
                # call 的 ToolResult 回喂，闭合 checkpoint 消息历史，支持多轮澄清往返。
                arguments = call.args_as_dict()
                input_request = UserInputRequestProposal(
                    request_type=arguments["request_type"],
                    question=arguments["question"],
                    resume_binding=arguments.get("resume_binding"),
                )
                pending_calls = (
                    {"action_id": action_id, "tool_call_id": call.tool_call_id, "kind": _CLARIFICATION_PENDING_KIND},
                )
                visible_text = arguments["question"]
            else:
                implementation = self._implementations[call.tool_name]
                actions = (
                    ProposedAction(
                        action_id=action_id,
                        tool_id=implementation.tool_id,
                        registry_version=implementation.registry_version,
                        arguments=call.args_as_dict(),
                    ),
                )
                pending_calls = (
                    {"action_id": action_id, "tool_call_id": call.tool_call_id},
                )
                visible_text = "已接纳，正在生成图片。"
        elif work.accepted_results:
            rejected = [r for r in work.accepted_results if r.status == "rejected"]
            if rejected:
                # IK2QBX 动作被治理拒绝后模型未再提议：用面向 User 的安全提示收尾，
                # 不暴露内部 reasonCode。模型若选择调整，会走 DeferredToolRequests 分支提新提议。
                message = rejected[-1].result.get("message")
                visible_text = (
                    message if isinstance(message, str) and message.strip()
                    else "图片生成未完成。"
                )
            elif all(result.status == "succeeded" for result in work.accepted_results):
                visible_text = "图片已经生成。"
            else:
                visible_text = "图片生成未完成。"
        else:
            # 初次推进或澄清恢复的纯文本输出（无工具调用）：模型可见文本直通，作为
            # 多轮自然对话的普通回应。澄清只来自显式 request_user_input 工具，不再由
            # 文本隐式触发（IK2QBY 退役隐式分支、解除「澄清恢复后必须出动作」自限）。
            visible_text = run_result.output.strip()
            if not visible_text:
                raise _ContractError("模型输出不能为空")

        checkpoint = RuntimeCheckpoint(
            engine=work.engine,
            engine_version=work.engine_version,
            adapter_schema_version=work.adapter_schema_version,
            opaque_payload={
                "format": "pydantic-ai-v1",
                "messages": ModelMessagesTypeAdapter.dump_python(
                    run_result.all_messages(), mode="json"
                ),
                "pending_calls": pending_calls,
            },
        )
        usage = run_result.usage
        return OrchestratorResult(
            commit_id=f"pydantic-ai-{work.agent_run_id}-{work.run_version}",
            visible_text=visible_text,
            checkpoint=checkpoint,
            actions=actions,
            usage={
                "input_units": usage.input_tokens,
                "output_units": usage.output_tokens,
                "requests": usage.requests,
            },
            input_request=input_request,
            bundle_evidence=self._evidence_payload(gate.evidence()),
        )

    @staticmethod
    def _replay_read_resource(messages: Any, gate: ResourceGate) -> None:
        """checkpoint 恢复时从消息历史确定性重建 read_resource 已读集合。

        已读账本不进 checkpoint；恢复时从历史中的 read_resource 工具调用重建，重建后
        集合继续受 activeContextMaxTokens 约束，恢复路径与首次读取走同一预算逻辑，
        不构成侧门。
        """
        for message in messages:
            for part in message.parts:
                if isinstance(part, ToolCallPart) and part.tool_name == "read_resource":
                    resource_id = part.args_as_dict().get("resource_id")
                    if isinstance(resource_id, str):
                        gate.register_from_history(resource_id)

    @staticmethod
    def _evidence_payload(
        evidence: tuple[ReadEvidence, ...]
    ) -> tuple[dict[str, Any], ...]:
        return tuple(
            {
                "resource_id": item.resource_id,
                "revision": item.revision,
                "content_digest": item.content_digest,
                "token_estimate": item.token_estimate,
                "origin": item.origin,
            }
            for item in evidence
        )

    def _build_tools(self, work: RunWork) -> tuple:
        """按当次 Run 钉住的 ToolGrant 动态构造模型可见工具集。

        只读 effect → 直接工具（handler 直接返回结果）；副作用 effect → deferred 工具
        （handler raise CallDeferred）。未列出的工具对模型完全不可见。grant 与实现目录的
        tool_name / registry_version / effect 任一不符 fail closed，并入现有契约归一化通道
        （ORCHESTRATOR_CONTRACT_MISMATCH），不泄露内部细节。``read_resource`` 不经 ToolGrant，
        作为 Bundle 固有受限读取工具在 ``_advance`` 中单独注入。
        """
        tools: list = []
        for grant in work.tool_grants:
            implementation = self._implementations.get(grant.tool_name)
            if implementation is None:
                raise _ContractError("授权工具不在 Worker 注册表")
            if implementation.registry_version != grant.registry_version:
                raise _ContractError("工具注册表版本与授权不符")
            if implementation.effect != grant.effect:
                raise _ContractError("工具效果类别与授权不符")
            tools.append(implementation.handler)
        return tuple(tools)

    @staticmethod
    def _validate_identity(work: RunWork) -> None:
        if (
            work.engine != ENGINE
            or work.engine_version != ENGINE_VERSION
            or work.adapter_schema_version != ADAPTER_SCHEMA_VERSION
        ):
            raise _ContractError("AgentRun 的编排引擎身份与 Adapter 不匹配")

    @staticmethod
    def _validate_checkpoint(work: RunWork) -> None:
        checkpoint = work.checkpoint
        if checkpoint is None:
            return
        if (
            checkpoint.engine != work.engine
            or checkpoint.engine_version != work.engine_version
            or checkpoint.adapter_schema_version != work.adapter_schema_version
            or checkpoint.opaque_payload.get("format") != "pydantic-ai-v1"
            or not isinstance(checkpoint.opaque_payload.get("messages"), list)
            or not isinstance(checkpoint.opaque_payload.get("pending_calls"), (list, tuple))
        ):
            raise _ContractError("RuntimeCheckpoint 与当前 AgentRun 不匹配或已损坏")

    @staticmethod
    def _failure(
        work: RunWork, code: str, message: str = "编排暂时无法继续。"
    ) -> OrchestratorResult:
        # visible_text 固定产品中性文案；error.message 携带规范化错误码对应的脱敏说明，
        # 供 Java 控制面按 code 做确定性重试或告警（契约 §6）。
        return OrchestratorResult(
            commit_id=f"pydantic-ai-{work.agent_run_id}-{work.run_version}",
            visible_text="编排暂时无法继续。",
            checkpoint=RuntimeCheckpoint(
                engine=ENGINE,
                engine_version=ENGINE_VERSION,
                adapter_schema_version=ADAPTER_SCHEMA_VERSION,
                opaque_payload={
                    "format": "pydantic-ai-v1",
                    "messages": (),
                    "pending_calls": (),
                },
            ),
            actions=(),
            error={"code": code, "message": message},
        )
