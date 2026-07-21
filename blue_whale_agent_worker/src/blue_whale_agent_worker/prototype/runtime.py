"""Bundle 驱动的流式 Agent Runtime（原型）。

验证问题（工单 IK2D8I）：
1. 每个 AgentRun 动态注入版本化 RoleDocument + always-on Rules 是否可靠；
2. 模型能否经受限 read_resource 工具按需读取 Skill 正文并留下已读证据；
3. 文本流、deferred tool request 与 checkpoint 恢复能否组合；
4. 不暴露 provider 原始字段的可审核合并文本块如何形成；
5. 取消/断连、重复提交与工具结果恢复时的框架行为。

结论记录在同目录 NOTES.md；本包不进入正式业务链路。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Mapping

from pydantic_ai import (
    Agent,
    CallDeferred,
    DeferredToolRequests,
    DeferredToolResults,
    RunContext,
)
from pydantic_ai.exceptions import UserError
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelResponse,
    ToolCallPart,
)
from pydantic_ai.models import Model

from .bundle import (
    MODEL_CAPABILITY_INSUFFICIENT,
    PROTOCOL_MIXED_STREAM,
    PROTOCOL_PENDING_CALL_MISMATCH,
    BundleError,
    BundleSnapshot,
    ResourceGate,
    sha256_text,
)
from .gateway import FakeGateway

CHUNK_WINDOW = 64  # 对齐 IK2D8M 冻结协议：可见文本 64 字符窗
PROTO_FORMAT = "proto-bundle-v1"

REQUIRED_CAPABILITIES = frozenset({"text", "tool_calling"})


def generate_image(prompt: str, aspect_ratio: str = "1:1") -> str:
    """proposing 一个图片生成动作，由 Java 控制面接纳（原型与正式契约同形）。"""
    raise CallDeferred


DEFERRED_TOOL_NAMES = frozenset({"generate_image"})


@dataclass(frozen=True)
class ProtoRunWork:
    agent_run_id: int
    run_version: int
    stream_id: str
    prompt: str | None  # 最新用户消息；deferred 恢复轮为 None
    pinned_bundle_version_id: str
    expected_manifest_digest: str
    checkpoint: Mapping[str, Any] | None = None
    accepted_results: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class ProtoOutcome:
    commit_id: str
    checkpoint_payload: dict[str, Any]
    actions: tuple[dict[str, Any], ...]
    pending_calls: tuple[dict[str, str], ...]
    input_request: str | None
    visible_text: str
    evidence: dict[str, Any]

    def to_commit_payload(self) -> dict[str, Any]:
        return {
            "commit_id": self.commit_id,
            "checkpoint": dict(self.checkpoint_payload),
            "actions": [dict(a) for a in self.actions],
            "user_input_request": self.input_request,
            "evidence": dict(self.evidence),
        }


class ChunkFormer:
    """把文本增量切成 64 字符窗，生成确定性幂等键（≤64 字符）。

    chunk payload 只含消毒后文本与协议字段：provider 的 tool_call_id、
    原始事件、usage 明细等一律不进入分块，从结构上回答「不暴露 provider
    原始 token」问题。skip_chars 用于确定性重放时跳过 gateway 已确认的前缀。
    """

    def __init__(
        self,
        agent_run_id: int,
        run_version: int,
        stream_id: str,
        start_seq: int = 1,
        skip_chars: int = 0,
    ) -> None:
        self._run_id = agent_run_id
        self._version = run_version
        self._stream_id = stream_id
        self._seq = start_seq
        self._skip = skip_chars
        self._buffer = ""
        self._full_text = ""

    def feed(self, delta: str) -> list[dict[str, Any]]:
        self._full_text += delta
        if self._skip:
            dropped = min(self._skip, len(delta))
            delta = delta[dropped:]
            self._skip -= dropped
        self._buffer += delta
        chunks: list[dict[str, Any]] = []
        while len(self._buffer) >= CHUNK_WINDOW:
            chunks.append(self._emit(self._buffer[:CHUNK_WINDOW]))
            self._buffer = self._buffer[CHUNK_WINDOW:]
        return chunks

    def finish(self) -> tuple[list[dict[str, Any]], str, int]:
        chunks = [self._emit(self._buffer)] if self._buffer else []
        self._buffer = ""
        return chunks, sha256_text(self._full_text), self._seq - 1

    def _emit(self, text: str) -> dict[str, Any]:
        chunk = {
            "stream_id": self._stream_id,
            "seq": self._seq,
            "idempotency_key": (
                f"proto-{self._run_id}-{self._version}-{self._stream_id}-c{self._seq:05d}"
            ),
            "text": text,
        }
        self._seq += 1
        return chunk

    @property
    def full_text(self) -> str:
        return self._full_text


class BundleAgentRuntime:
    """每个 AgentRun 一个实例：按固定 BundleVersion 构造 Agent 并流式推进。"""

    def __init__(self, snapshot: BundleSnapshot, model: Model | str) -> None:
        self._snapshot = snapshot
        self._model = model

    def _check_capabilities(self) -> None:
        missing = REQUIRED_CAPABILITIES - self._snapshot.model_profile.capabilities
        if missing:
            raise BundleError(
                MODEL_CAPABILITY_INSUFFICIENT,
                f"ModelProfile 缺少必需能力: {sorted(missing)}",
            )

    def _build_agent(self, gate: ResourceGate) -> Agent[ResourceGate, Any]:
        agent: Agent[ResourceGate, Any] = Agent(
            self._model,
            output_type=(str, DeferredToolRequests),
            instructions=gate.initial_instructions(),
            deps_type=ResourceGate,
            tools=[generate_image],
            retries=0,
        )

        @agent.tool
        async def read_resource(ctx: RunContext[ResourceGate], resource_id: str) -> str:
            """按发布快照中已固化的 resourceId 读取 on_demand 资源（受限、记账）。"""
            return ctx.deps.read(resource_id).content

        return agent

    async def advance(self, work: ProtoRunWork, gateway: FakeGateway) -> ProtoOutcome:
        self._check_capabilities()
        gate = ResourceGate(
            self._snapshot,
            pinned_bundle_version_id=work.pinned_bundle_version_id,
            expected_manifest_digest=work.expected_manifest_digest,
        )
        message_history = None
        deferred_results = None
        if work.checkpoint is not None:
            message_history, deferred_results = self._restore(work, gate)

        gateway.start_assistant_message(
            work.agent_run_id, {"stream_id": work.stream_id}
        )
        acked = gateway.acked_seq(work.stream_id)
        former = ChunkFormer(
            work.agent_run_id,
            work.run_version,
            work.stream_id,
            start_seq=acked + 1,
            skip_chars=acked * CHUNK_WINDOW,
        )
        agent = self._build_agent(gate)
        try:
            async with agent.run_stream(
                work.prompt,
                message_history=message_history,
                deferred_tool_results=deferred_results,
                deps=gate,
            ) as streamed:
                try:
                    async for delta in streamed.stream_text(delta=True):
                        for chunk in former.feed(delta):
                            gateway.append_assistant_message_chunk(
                                work.agent_run_id, chunk
                            )
                except UserError:
                    pass  # 纯工具响应（无文本部分），stream_text 不可用属正常
                output = await streamed.get_output()
                messages = streamed.all_messages()
        except asyncio.CancelledError:
            # 取消/断连：标记该流作废；未 complete 的私有分块永不释放，
            # 恢复重跑由确定性重放（同键去重）或整流重建（新 stream_id）承接。
            gateway.abort_assistant_message(
                work.agent_run_id, {"stream_id": work.stream_id}
            )
            raise

        if isinstance(output, str):
            self._reject_mixed_stream(messages)
        # deferred 动作轮不产生可见文本：无文本即无分块，
        # 「所有可见文本都过分块协议」的不变量由文本轮独立保证。

        visible_text = former.full_text
        if visible_text:
            tail, digest, count = former.finish()
            for chunk in tail:
                gateway.append_assistant_message_chunk(work.agent_run_id, chunk)
            gateway.complete_assistant_message(
                work.agent_run_id,
                {"stream_id": work.stream_id, "digest": digest, "chunk_count": count},
            )

        actions: tuple[dict[str, Any], ...] = ()
        pending_calls: tuple[dict[str, str], ...] = ()
        input_request: str | None = None
        if isinstance(output, DeferredToolRequests):
            if len(output.calls) != 1:
                raise BundleError(
                    PROTOCOL_PENDING_CALL_MISMATCH,
                    "原型契约：必须且只能提出一个外部动作",
                )
            call = output.calls[0]
            action_id = f"proto-image-{work.agent_run_id}-{work.run_version}"
            actions = (
                {
                    "action_id": action_id,
                    "action_type": call.tool_name,
                    "arguments": call.args_as_dict(),
                },
            )
            pending_calls = (
                {"action_id": action_id, "tool_call_id": call.tool_call_id},
            )
        else:
            text = output.strip()
            if not text:
                raise BundleError(PROTOCOL_MIXED_STREAM, "空文本输出不可接纳")
            input_request = text  # 多轮澄清：每轮 str 输出都转为输入请求提议

        checkpoint_payload = {
            "format": PROTO_FORMAT,
            "messages": ModelMessagesTypeAdapter.dump_python(messages, mode="json"),
            "pending_calls": list(pending_calls),
            "stream_id": work.stream_id,
        }
        return ProtoOutcome(
            commit_id=f"proto-{work.agent_run_id}-{work.run_version}",
            checkpoint_payload=checkpoint_payload,
            actions=actions,
            pending_calls=pending_calls,
            input_request=input_request,
            visible_text=visible_text,
            evidence=gate.evidence(),
        )

    def _restore(
        self, work: ProtoRunWork, gate: ResourceGate
    ) -> tuple[list[Any], DeferredToolResults | None]:
        payload = dict(work.checkpoint or {})
        if payload.get("format") != PROTO_FORMAT:
            raise BundleError(
                PROTOCOL_PENDING_CALL_MISMATCH, "checkpoint 格式与原型 Adapter 不符"
            )
        messages = ModelMessagesTypeAdapter.validate_python(payload["messages"])
        # 已读账本不从 checkpoint 复制（契约 §6：checkpoint 不嵌 Bundle 内容），
        # 而是从消息历史中的 read_resource 调用确定性地重建。
        for message in messages:
            for part in message.parts:
                if isinstance(part, ToolCallPart) and part.tool_name == "read_resource":
                    resource_id = part.args_as_dict().get("resource_id")
                    if isinstance(resource_id, str):
                        gate.register_from_history(resource_id)
        pending = payload.get("pending_calls") or []
        if not pending:
            return messages, None
        expected = {str(p["tool_call_id"]) for p in pending}
        if set(work.accepted_results) != expected:
            raise BundleError(
                PROTOCOL_PENDING_CALL_MISMATCH,
                "已接纳结果与 checkpoint 待处理动作不对齐",
            )
        results = DeferredToolResults(
            calls={
                tool_call_id: dict(work.accepted_results[tool_call_id])
                for tool_call_id in expected
            }
        )
        return messages, results

    @staticmethod
    def _reject_mixed_stream(messages: list[Any]) -> None:
        """流式路径的关键失败模式防护（本原型实测确认于 2.9.0）：

        模型在同一流式响应里既给 deferred 工具调用又给文本时，
        get_output() 静默返回 str 并丢失 deferred 请求。适配层必须检测
        并 fail closed，交由规范轮（纯工具响应）重试，不得静默放行文本。
        """
        if not messages:
            return
        last = messages[-1]
        if isinstance(last, ModelResponse) and any(
            isinstance(part, ToolCallPart) and part.tool_name in DEFERRED_TOOL_NAMES
            for part in last.parts
        ):
            raise BundleError(
                PROTOCOL_MIXED_STREAM,
                "流式响应混合了文本与 deferred 动作，框架会静默丢弃动作",
            )
