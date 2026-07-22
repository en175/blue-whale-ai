import json
from typing import Any, Callable, Mapping, Sequence

from pydantic_ai import (
    Agent,
    CallDeferred,
    DeferredToolRequests,
    DeferredToolResults,
    RunContext,
    Tool,
)
from pydantic_ai.messages import ModelMessagesTypeAdapter, TextPart, ToolCallPart
from pydantic_ai.models import Model

from .bundle.errors import BundleError
from .bundle.gate import ReadEvidence, ResourceGate
from .bundle.loader import ContextLoader, LoadedContext
from .bundle.source import BundleSource
from .bundle.verifier import BundleVerifier, VerifiedSnapshot
from .contracts import (
    ConversationSource,
    CreativeContextSource,
    OrchestratorResult,
    ProposedAction,
    RunWork,
    RuntimeCheckpoint,
    ToolGrant,
    UserInputRequestProposal,
)


ENGINE = "pydantic-ai"
ENGINE_VERSION = "2.9.0"
ADAPTER_SCHEMA_VERSION = 1

# read effect 直接工具的注册表版本（read_conversation_* 与 IK2QC7 创作现场五工具统一 v1，
# 与 Java 工具注册表对齐）。
READ_DIRECT_TOOL_REGISTRY_VERSION = 1

# checkpoint pending_calls 项的 kind 标记：澄清 deferred call 恢复时用用户自然语言
# 回答作 ToolResult 回喂，区别于动作 pending（结果来自 accepted_results）。
_CLARIFICATION_PENDING_KIND = "clarification"

class _ContractError(Exception):
    pass


def read_resource(ctx: RunContext[ResourceGate], resource_id: str) -> str:
    """按发布快照固化的 resourceId 读取 on_demand 资源正文（受限、记账）。

    Bundle 固有受限读取工具，独立于当次 ToolGrant（业务动作工具）：每个有 Bundle pin
    的 Run 总注入，由 ResourceGate 做 digest 比对与双预算门，运行时不做路径 / 网络 /
    跨 Bundle 寻址。
    """
    return ctx.deps.read(resource_id)


class PydanticAIOrchestrator:
    def __init__(
        self,
        model: Model | str,
        bundle_source: BundleSource,
        conversation_source: ConversationSource | None = None,
        creative_context_source: CreativeContextSource | None = None,
    ) -> None:
        self._model = model
        self._bundle_source = bundle_source
        self._conversation_source = conversation_source
        self._creative_context_source = creative_context_source

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
        # 对话读取（IK2QBZ read_conversation_*）复用同一闸门与账本：无 manifest digest
        # 可比，但共享双预算门、活动上下文累计与证据通道（origin=conversation）。
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
            tools=(*self._build_tools(work, gate), read_resource),
            deps_type=ResourceGate,
        )
        if work.checkpoint is None:
            prompt = next(
                message["content"]
                for message in reversed(work.messages)
                if message["role"] == "user"
            )
            # IK2QC8：首轮把 claim 下发的画布媒体节点拼成紧凑上下文，让素材第一时间进入 Agent
            # 视野（契约 §6.1）。默认 canvas_nodes 为空集 → 不注入，既有首轮行为不变。
            if work.canvas_nodes:
                prompt = self._canvas_materials_prompt(work.canvas_nodes) + "\n\n" + prompt
            # IK3AH2（契约 §6.1 三段式）：首轮注入 Conversation 摘要，与画布节点并列前置。
            # 默认 conversation_summary 为 None → 不注入，既有首轮行为不变。
            if work.conversation_summary:
                prompt = self._conversation_summary_prompt(work.conversation_summary) + "\n\n" + prompt
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
                action_pending = [
                    pending for pending in restored_calls
                    if pending.get("kind") != _CLARIFICATION_PENDING_KIND
                ]
                # IK3AH2：clarification 软回喂的 rejected 共用 accepted_results 通道但属 clarify 命名空间，
                # 不参与 action 一一匹配——results_by_action 只收 action pending 对应的结果。
                action_pending_ids = {pending["action_id"] for pending in action_pending}
                results_by_action = {
                    result.action_id: result for result in work.accepted_results
                    if result.action_id in action_pending_ids
                }
                if action_pending_ids != set(results_by_action):
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
                    rejected = next(
                        (r for r in work.accepted_results if r.status == "rejected"), None
                    )
                    if rejected is not None:
                        # IK3AH2：服务端 grant 未授予的澄清被软回喂为 rejected，回喂该 tool_call_id
                        # 拒绝结果，不取用户回答，让模型改走动作路径。
                        for pending in clarify_pending:
                            deferred_calls[pending["tool_call_id"]] = {
                                "status": "rejected",
                                "result": dict(rejected.result),
                            }
                    else:
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
            authorized_side_effects = {
                grant.tool_name for grant in work.tool_grants if grant.effect == "side_effect"
            }
            # 解除单动作自限（IK3BG0）：一轮可零或多个副作用动作提议，按 Java commit 契约
            # 分批提交、逐一经铁闸接纳（RunCommitRequest.actions 是 List）。PROPOSAL_ACTION_MUTEX
            # （UserInputRequest 提议与副作用动作互斥）由 Java 铁闸权威判定，Worker 不自立规矩。
            side_effect_calls: list[ToolCallPart] = []
            for call in requests.calls:
                if call.tool_name not in authorized_side_effects:
                    raise _ContractError("模型提出了不在当次授权集合内的工具动作")
                if call.tool_name == "request_user_input":
                    # 显式澄清工具（IK2QBY）：参数映射 UserInputRequestProposal，仍走 ADR-0036
                    # 通道。挂 clarification pending——恢复时把用户自然语言回答作为该 deferred
                    # call 的 ToolResult 回喂，闭合 checkpoint 消息历史，支持多轮澄清往返。
                    # toolName "request_user_input" 由 ADR-0036 固定为 Java 注册表 toolId，不随
                    # grant 动态化；同 Run 同时最多一个活动 UserInputRequest（ADR-0036 铁闸），
                    # 故此分支 action_id 不带序号（副作用多动作分批才需序号保证 Run 内唯一）。
                    arguments = call.args_as_dict()
                    input_request = UserInputRequestProposal(
                        request_type=arguments["request_type"],
                        question=arguments["question"],
                        resume_binding=arguments.get("resume_binding"),
                    )
                    action_id = f"pydantic-{call.tool_name}-{work.agent_run_id}-{work.run_version}"
                    pending_calls += (
                        {"action_id": action_id, "tool_call_id": call.tool_call_id, "kind": _CLARIFICATION_PENDING_KIND},
                    )
                else:
                    side_effect_calls.append(call)
            # 多副作用动作分批：每个 call 一个 ProposedAction，action_id 含序号保证 Run 内
            # 唯一（幂等键）；tool_id 即 grant.tool_name（= Java 注册表 toolId），registry_version
            # 取自当次 grant，逐一经 Java commit 铁闸复验接纳。
            grants_by_name = {grant.tool_name: grant for grant in work.tool_grants}
            for idx, call in enumerate(side_effect_calls):
                grant = grants_by_name[call.tool_name]
                action_id = f"pydantic-{call.tool_name}-{work.agent_run_id}-{work.run_version}-{idx}"
                actions += (
                    ProposedAction(
                        action_id=action_id,
                        tool_id=call.tool_name,
                        registry_version=grant.registry_version,
                        arguments=call.args_as_dict(),
                    ),
                )
                pending_calls += (
                    {"action_id": action_id, "tool_call_id": call.tool_call_id},
                )
            # deferred 动作轮可见文本一律来自模型 TextPart，不再用固定文案冒充模型回复
            # （「deferred 动作轮无可见文本」是模型行为的不变量；instructions 引导动作轮
            # 附过渡说明以满足 RunCommitRequest.visibleText 非空契约）。澄清轮用模型 question。
            if input_request is not None:
                visible_text = input_request.question
            else:
                visible_text = self._model_visible_text(run_result)
                if not visible_text:
                    raise _ContractError("deferred 动作轮缺少模型可见文本")
        else:
            # 纯咨询 / 终态轮：模型可见文本直通，不再用固定文案替换（动作/终态轮不再
            # 出现固定文案冒充模型回复）。终态轮的安全提示由模型自身输出（Bundle instructions
            # 引导模型看到治理拒绝结果后转述，见测试 safe_message_after_rejection_model）；
            # 模型本轮无可见文本即 fail closed，Worker 不用 Java message 制造文本。
            visible_text = self._model_visible_text(run_result)
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

    @staticmethod
    def _record(gate: ResourceGate, resource_id: str, data: Any) -> str:
        """fetch 后统一 json.dumps + charge_conversation 记账 + 返回紧凑文本。

        read effect 直接工具（对话读取与创作现场读取）共用同一记账形态：内容紧凑序列化后
        经 ResourceGate 双预算门记账（origin=conversation），返回模型可见文本。
        """
        content = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        gate.charge_conversation(resource_id, content)
        return content

    @staticmethod
    def _canvas_materials_prompt(canvas_nodes: Sequence[Mapping[str, Any]]) -> str:
        """IK2QC8：首轮把 claim 下发的画布媒体节点拼成紧凑上下文（契约 §6.1）。

        仅列携带 assetId 的媒体节点（type + assetId），完整节点 data 与素材正文由
        ``list_canvas_nodes`` / ``read_canvas_node`` / ``read_asset`` 按需读取。
        """
        lines = ["用户当前画布上的素材（可经 read_asset 读取）："]
        for node in canvas_nodes:
            lines.append(f"- type={node.get('type')}, asset_id={node.get('asset_id')}")
        return "\n".join(lines)

    @staticmethod
    def _conversation_summary_prompt(summary: Mapping[str, Any]) -> str:
        """IK3AH2：首轮把 claim 下发的 Conversation 摘要拼成紧凑上下文（契约 §6.1 三段式）。

        仅渲染摘要切片（消息计数 + 首末预览 + 时间范围），完整历史由
        ``read_conversation_history`` 游标分页按需读取。None 字段跳过。
        """
        lines = ["对话历史摘要（更早消息可经 read_conversation_history 读取）："]
        if summary.get("conversation_id") is not None:
            lines.append(f"- conversation_id={summary.get('conversation_id')}")
        lines.append(f"- message_count={summary.get('message_count')}")
        if summary.get("first_user_preview") is not None:
            lines.append(f"- first_user_preview={summary.get('first_user_preview')}")
        if summary.get("last_message_preview") is not None:
            lines.append(f"- last_message_preview={summary.get('last_message_preview')}")
        if summary.get("earliest_at") is not None:
            lines.append(f"- earliest_at={summary.get('earliest_at')}")
        if summary.get("latest_at") is not None:
            lines.append(f"- latest_at={summary.get('latest_at')}")
        return "\n".join(lines)

    def _build_tools(self, work: RunWork, gate: ResourceGate) -> tuple:
        """按当次 Run 钉住的 ToolGrant 动态构造模型可见工具集。

        side_effect effect → 按 ToolGrant.argument_schema（平台 ToolRegistry input schema）
        构造 deferred 提议工具（handler raise CallDeferred，模型提议、Java 接纳后执行），
        模型可见 schema 完全由发布内容决定，Worker 不携带硬编码工具实现目录。read effect
        → 只读源协议直接工具（per-advance 闭包，读后经 ResourceGate 双预算门记账，
        origin=conversation，与 Bundle 资源同一活动上下文账本）。未列出的工具对模型完全
        不可见；effect 非法或 read 工具不在注册表 fail closed，并入现有契约归一化通道
        （ORCHESTRATOR_CONTRACT_MISMATCH），不泄露内部细节。``read_resource`` 不经 ToolGrant，
        作为 Bundle 固有受限读取工具在 ``_advance`` 中单独注入。
        """
        tools: list = []
        for grant in work.tool_grants:
            if grant.effect == "side_effect":
                tools.append(self._make_deferred_tool(grant))
            elif grant.effect == "read":
                if grant.registry_version != READ_DIRECT_TOOL_REGISTRY_VERSION:
                    raise _ContractError("工具注册表版本与授权不符")
                factory = self._read_tool_factory(grant.tool_name)
                if factory is None:
                    raise _ContractError("授权工具不在 Worker 注册表")
                tools.append(factory(work, gate))
            else:
                raise _ContractError("工具效果类别与授权不符")
        return tuple(tools)

    @staticmethod
    def _make_deferred_tool(grant: ToolGrant) -> Tool:
        """按 ToolGrant.argument_schema 构造 deferred 提议工具（IK3BG0 工具目录泛化）。

        effect=side_effect 工具不再来自硬编码函数目录：handler 仅 raise CallDeferred 把
        执行权交还框架（模型提议、Java 接纳后执行），模型可见参数 schema 由 Run pin 的
        ToolGrant.argument_schema（Draft 2020-12，平台 ToolRegistry input schema）驱动，
        工具名即 grant.tool_name（= Java 注册表 toolId）。
        """

        def deferred_handler(**_kwargs: Any) -> str:
            raise CallDeferred

        return Tool.from_schema(
            deferred_handler,
            name=grant.tool_name,
            description=None,
            json_schema=dict(grant.argument_schema),
        )

    @staticmethod
    def _model_visible_text(run_result: Any) -> str:
        """提取模型本轮可见文本：纯文本轮取 output，deferred 动作轮取最后 ModelResponse 的 TextPart。

        动作提议轮与终态轮不再用固定文案替换模型文本——可见文本一律来自模型自身输出，
        「deferred 动作轮无可见文本」作为模型行为的直接不变量（Worker 不制造文案）。
        """
        output = run_result.output
        if isinstance(output, str):
            return output.strip()
        for message in reversed(run_result.all_messages()):
            for part in message.parts:
                if isinstance(part, TextPart) and part.content.strip():
                    return part.content.strip()
        return ""

    def _read_tool_factory(
        self, tool_name: str
    ) -> Callable[[RunWork, ResourceGate], Callable[..., object]] | None:
        """read effect 直接工具的闭包工厂；对应 source 未配置时该工具不可见。"""
        if tool_name in ("read_conversation_summary", "read_conversation_history"):
            if self._conversation_source is None:
                return None
            if tool_name == "read_conversation_summary":
                return self._make_read_conversation_summary
            return self._make_read_conversation_history
        if self._creative_context_source is None:
            return None
        creative_factories = {
            "list_canvas_nodes": self._make_list_canvas_nodes,
            "read_canvas_node": self._make_read_canvas_node,
            "read_asset": self._make_read_asset,
            "read_generation_job_status": self._make_read_generation_job_status,
            "list_creative_skills": self._make_list_creative_skills,
        }
        return creative_factories.get(tool_name)

    def _make_read_conversation_summary(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def read_conversation_summary() -> str:
            """读取当前对话的紧凑摘要（消息数 / 首末预览 / 时间范围）。"""
            data = self._conversation_source.fetch_conversation_summary(work.agent_run_id)
            return self._record(gate, f"conversation:{work.conversation_id}:summary", data)

        return read_conversation_summary

    def _make_read_conversation_history(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def read_conversation_history(after: int | None = None, limit: int = 20) -> str:
            """按 sequence_no 游标读取对话历史（升序），after 为上一页 nextCursor。"""
            data = self._conversation_source.fetch_conversation_history(
                work.agent_run_id, after=after, limit=limit
            )
            resource_id = f"conversation:{work.conversation_id}:history"
            if after is not None:
                resource_id += f":after:{after}"
            return self._record(gate, resource_id, data)

        return read_conversation_history

    def _make_list_canvas_nodes(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def list_canvas_nodes(limit: int | None = None) -> str:
            """读取当前 Project 画布的节点摘要列表（nodeId / type / assetId，紧凑限流）。"""
            data = self._creative_context_source.fetch_canvas_nodes(
                work.agent_run_id, limit=limit
            )
            return self._record(gate, f"context:{work.project_id}:canvas_nodes", data)

        return list_canvas_nodes

    def _make_read_canvas_node(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def read_canvas_node(node_id: str) -> str:
            """读取单个画布节点详情（含原始 data 对象，前端 React Flow 定义）。"""
            data = self._creative_context_source.fetch_canvas_node(
                work.agent_run_id, node_id
            )
            return self._record(gate, f"context:{work.project_id}:canvas_node:{node_id}", data)

        return read_canvas_node

    def _make_read_asset(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def read_asset(asset_id: int) -> str:
            """读取单个 Asset 元数据（仅放行画布引用 ∪ 本 Run 产物范围内的 Asset）。"""
            data = self._creative_context_source.fetch_asset(work.agent_run_id, asset_id)
            return self._record(gate, f"context:{work.project_id}:asset:{asset_id}", data)

        return read_asset

    def _make_read_generation_job_status(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def read_generation_job_status(job_id: int) -> str:
            """读取单个生成任务的紧凑状态（status / progress / error / outputs）。"""
            data = self._creative_context_source.fetch_generation_job_status(
                work.agent_run_id, job_id
            )
            return self._record(gate, f"context:{work.project_id}:job_status:{job_id}", data)

        return read_generation_job_status

    def _make_list_creative_skills(
        self, work: RunWork, gate: ResourceGate
    ) -> Callable[..., object]:
        def list_creative_skills() -> str:
            """读取 Run 固定 Bundle 里的 Creative Skill 元数据列表（name / description）。"""
            data = self._creative_context_source.fetch_creative_skills(work.agent_run_id)
            return self._record(gate, f"context:{work.project_id}:creative_skills", data)

        return list_creative_skills

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
