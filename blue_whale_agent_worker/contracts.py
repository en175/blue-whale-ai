from dataclasses import dataclass
from typing import Any, Mapping, Optional, Protocol, Sequence


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
    checkpoint: Optional[Mapping[str, Any]]


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


@dataclass(frozen=True)
class OrchestratorResult:
    commit_id: str
    visible_text: str
    checkpoint: Mapping[str, Any]
    actions: Sequence[ProposedAction]
    usage: Optional[Mapping[str, Any]] = None

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
            "checkpoint": {"opaque_payload": dict(self.checkpoint)},
            "actions": [action.to_payload() for action in self.actions],
            "usage": dict(self.usage) if self.usage is not None else None,
        }


class OrchestratorPort(Protocol):
    def advance(self, work: RunWork) -> OrchestratorResult:
        """根据权威工作包产生产品中性提案，不直接写产品状态。"""


class RunGateway(Protocol):
    def claim(self) -> RunWork:
        """从 Java Product API 领取一个带租约和栅栏的工作包。"""

    def commit(self, run_id: int, payload: dict[str, Any]) -> None:
        """把提案提交给 Java Product API 做权威校验和持久化。"""
