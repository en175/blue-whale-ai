from dataclasses import dataclass
from typing import Any, Mapping, Optional, Protocol, Sequence


@dataclass(frozen=True)
class RuntimeCheckpoint:
    engine: str
    engine_version: str
    adapter_schema_version: int
    opaque_payload: Mapping[str, Any]


@dataclass(frozen=True)
class AcceptedActionResult:
    action_id: str
    status: str
    result: Mapping[str, Any]


@dataclass(frozen=True)
class RunWork:
    agent_run_id: int
    project_id: int
    conversation_id: int
    user_id: int
    run_version: int
    fencing_token: int
    engine: str
    engine_version: str
    adapter_schema_version: int
    messages: Sequence[Mapping[str, str]]
    checkpoint: Optional[RuntimeCheckpoint]
    accepted_results: Sequence[AcceptedActionResult] = ()


@dataclass(frozen=True)
class ProposedAction:
    action_id: str
    action_type: str
    arguments: Mapping[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "action_type": self.action_type,
            "arguments": dict(self.arguments),
        }


# 产品级输入请求类型，与 Java UserInputRequest 常量对齐。
REQUEST_TYPE_CREATION_CLARIFICATION = "creation_clarification"


@dataclass(frozen=True)
class UserInputRequestProposal:
    """产品中性输入请求提议（OrchestratorPort 输出，由 Java Product API 校验并接纳）。

    提议必须是产品中性的：不携带供应商私有字段（provider、价格目录、汇率、模型策略），
    也不暴露 Pydantic AI、DeferredToolRequest 等框架内部形态。与同一次 RunCommit 提交中的
    动作执行结果互斥：一次提交要么推进一个动作，要么提出一个输入请求，不能同时存在。

    首版只支持创作澄清（creation_clarification）；成本确认仍由 Java 侧
    GenerationAuthorizationGate 的 INPUT_REQUIRED 决策在 commit 内部创建。
    """

    request_type: str
    question: str
    resume_binding: Optional[Mapping[str, Any]] = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "request_type": self.request_type,
            "question": self.question,
        }
        if self.resume_binding is not None:
            payload["resume_binding"] = dict(self.resume_binding)
        return payload


@dataclass(frozen=True)
class OrchestratorResult:
    commit_id: str
    visible_text: str
    checkpoint: RuntimeCheckpoint
    actions: Sequence[ProposedAction]
    usage: Optional[Mapping[str, Any]] = None
    error: Optional[Mapping[str, str]] = None
    input_request: Optional[UserInputRequestProposal] = None

    def to_commit_payload(self, work: RunWork) -> dict[str, Any]:
        return {
            "commit_id": self.commit_id,
            "project_id": work.project_id,
            "user_id": work.user_id,
            "expected_run_version": work.run_version,
            "fencing_token": work.fencing_token,
            "engine": work.engine,
            "engine_version": work.engine_version,
            "adapter_schema_version": work.adapter_schema_version,
            "visible_text": self.visible_text,
            "checkpoint": {"opaque_payload": dict(self.checkpoint.opaque_payload)},
            "actions": [action.to_payload() for action in self.actions],
            "usage": dict(self.usage) if self.usage is not None else None,
            "error": dict(self.error) if self.error is not None else None,
            "user_input_request": (
                self.input_request.to_payload() if self.input_request is not None else None
            ),
        }


class OrchestratorPort(Protocol):
    def advance(self, work: RunWork) -> OrchestratorResult:
        """根据权威工作包产生产品中性提案，不直接写产品状态。"""


class RunGateway(Protocol):
    def claim(self) -> RunWork:
        """从 Java Product API 领取一个带租约和栅栏的工作包。"""

    def commit(self, run_id: int, payload: dict[str, Any]) -> None:
        """把提案提交给 Java Product API 做权威校验和持久化。"""
