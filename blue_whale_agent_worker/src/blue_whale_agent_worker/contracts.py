from dataclasses import dataclass
from typing import Any, Literal, Mapping, Optional, Protocol, Sequence


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
class ToolGrant:
    """Run 钉住的 BundleVersion 授权工具子集（契约 §2.5 ToolGrant）。

    Worker Adapter 按当次 Run 的 toolGrants 动态构造模型可见工具集：未列出的工具
    对模型完全不可见，权限边界在提示词层成立。effect 决定注册方式（read 直接工具、
    side_effect deferred 工具）。契约违约（工具不在注册表 / 版本漂移 / effect 不符）fail closed。
    """

    tool_name: str
    registry_version: int
    effect: Literal["read", "side_effect"]
    proposal_only: bool
    argument_schema: Mapping[str, Any]
    constraints: Mapping[str, Any]


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
    # AgentRun 固定的 Runtime Bundle / ModelProfile / CreativeSkill pin（契约 §6）。
    # Java 在创建 AgentRun 时原子固定；enforcement-enabled=true 时下发，测试环境
    # （enforcement-enabled=false）为 None。Worker 按 bundle_version_id 拉取发布快照，
    # 用 manifest_digest 与本地重算值逐字节比对；字段不再被 claim 载荷解析丢弃。
    bundle_version_id: Optional[str] = None
    manifest_digest: Optional[str] = None
    model_profile_id: Optional[str] = None
    model_profile_version: Optional[str] = None
    activated_creative_skill_versions: Optional[Sequence[Any]] = None
    # 当次 Run 钉住的 ToolGrant 子集（契约 §2.5）：Adapter 据此动态构造模型可见工具集，
    # 未授权工具对模型完全不可见。enforcement-disabled 时 Java 不下发，gateway 解析为空集。
    tool_grants: Sequence[ToolGrant] = ()


@dataclass(frozen=True)
class ProposedAction:
    """Agent 提议的工具动作（注册表驱动）。

    tool_id + registry_version 绑定注册表 ToolDefinition，自由 action_type 已退役；
    action_id 确定性、Run 内唯一，作幂等键：同一 action_id 重复提交不产生重复 GenerationJob 或重复成本预留。
    """

    action_id: str
    tool_id: str
    registry_version: int
    arguments: Mapping[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "tool_id": self.tool_id,
            "registry_version": self.registry_version,
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
    # 资源读取证据（契约 §6 第 4 条）：随 commit 回传 Java，与 usage 指标同通道。
    bundle_evidence: Optional[Sequence[Mapping[str, Any]]] = None

    def to_commit_payload(
        self, work: RunWork, assistant_message_stream_id: Optional[str] = None
    ) -> dict[str, Any]:
        payload = {
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
            "bundle_evidence": (
                [dict(entry) for entry in self.bundle_evidence]
                if self.bundle_evidence is not None
                else None
            ),
        }
        if assistant_message_stream_id is not None:
            payload["assistant_message_stream_id"] = assistant_message_stream_id
        return payload


class OrchestratorPort(Protocol):
    def advance(self, work: RunWork) -> OrchestratorResult:
        """根据权威工作包产生产品中性提案，不直接写产品状态。"""


class RunGateway(Protocol):
    def claim(self) -> RunWork:
        """从 Java Product API 领取一个带租约和栅栏的工作包。"""

    def commit(self, run_id: int, payload: dict[str, Any]) -> None:
        """把提案提交给 Java Product API 做权威校验和持久化。"""

    def start_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        """建立不含未审核文本的 Assistant 消息流。"""

    def append_assistant_message_chunk(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        """把原始文本块交给 Java 私有持久化与发布门。"""

    def complete_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        """校验并完成 Assistant 消息流。"""


class ConversationSource(Protocol):
    """对话历史只读源（IK2QBZ）：Worker 经它按需回溯当前 Run 绑定的 Conversation。

    JavaRunGateway 天然满足（duck-typed）。端点以 runId 为根，Project 范围由 run 绑定闭环。
    """

    def fetch_conversation_summary(self, run_id: int) -> Mapping[str, Any]:
        """读取当前对话摘要（消息数 / 首末预览 / 时间范围）。"""

    def fetch_conversation_history(
        self,
        run_id: int,
        after: Optional[int] = None,
        limit: int = 20,
    ) -> Mapping[str, Any]:
        """按 sequence_no 游标分页读取对话历史（升序）；after 为上一页 nextCursor。"""
