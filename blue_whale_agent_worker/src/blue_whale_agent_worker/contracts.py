from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Optional, Protocol, Sequence


class AgentRunConflictError(RuntimeError):
    """Java 铁闸 409（AGENT_RUN_CONFLICT，业务码 100303）：Run 已被取代或租约失效。

    与其余 RuntimeError（崩溃重试）区分：调用方捕获后打一条结构化 warn 日志并
    exit 0，不再提交任何状态。
    """


class StreamAttemptExhaustedError(RuntimeError):
    """Java 409（ASSISTANT_STREAM_ATTEMPT_EXHAUSTED，业务码 100305，契约 §2.3）。

    回复流尝试额度（2 次）已用尽：Run 绑定仍有效但不允许再开新尝试，调用方应在
    不再次调用模型的情况下提交规范化错误。
    """


class MixedStreamError(RuntimeError):
    """F1（契约 §3.3 PROTOCOL_MIXED_STREAM）：流式响应混合可见文本与 deferred 动作。

    pydantic-ai 2.9.0 在混流时 get_output() 静默返回 str 并丢失 deferred 请求
    （原型 IK2D8I 实测确认）。Orchestrator 检测后抛出，Worker 捕获 → abort 当前
    尝试（reason_code=PROTOCOL_MIXED_STREAM）→ 新 stream_id 纯动作轮重试，
    绝不静默放行文本、绝不静默丢动作。streamed_text 携带混流轮已流出的全部
    可见文本（含未满窗缓冲），Worker 按 abort 响应的 released_sequence_no 截取
    未放行尾部后在重试轮确定性重放；usage 携带混流轮真实发生的模型用量，
    由 Worker 聚合进最终 commit（工单验收：用量覆盖所有真实尝试）。
    """

    def __init__(
        self,
        message: str,
        streamed_text: str = "",
        usage: Optional[Mapping[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.streamed_text = streamed_text
        self.usage = dict(usage) if usage is not None else None


class ChunkDeliveryError(RuntimeError):
    """流式期间 chunk 送达 gateway 失败（传输类错误，F3 DISCONNECT 路径）。

    Worker 的 emit_chunk sink 把 gateway 传输错误包装成此类型，使 Orchestrator
    不把它归一化为编排失败；Worker 外层捕获后 best-effort abort（DISCONNECT）
    并原样抛出（维持崩溃重试语义），abort 未送达由 Java LEASE_TAKEOVER 兜底（契约 §4）。
    """


class CreativeSkillActivationError(RuntimeError):
    """auto 激活被 Java 确定性拒绝（契约 §8）。

    携带稳定 ``code``（契约 §8 符号名，如 CREATIVE_SKILL_NOT_A_CANDIDATE /
    CREATIVE_SKILL_ALREADY_ACTIVATED / IDEMPOTENCY_KEY_REUSED 等）与人类可读
    ``message``。Worker 捕获后走 error commit 通道使 Run 进入 failed 终态——
    确定性拒绝崩溃重试会无限循环，error commit 才是「不降级」的正确体现（契约 §4.2.5）。
    与 AgentRunConflictError（确定性退出 / Run 已终态）、RuntimeError（瞬态崩溃重试）区分。
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


# 流式可见文本分块回调（IK3BG3）：Orchestrator 经 ChunkFormer 成块后逐块回调，
# 由 Worker 的 sink 合并 RunBinding 并调 append_assistant_message_chunk。
ChunkSink = Callable[[Mapping[str, Any]], None]


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


# auto reason.detail.matched_fields 的封闭枚举（契约 §4.3）。
# 单一来源：选择模型的结构化 schema 与 http_gateway 的 reason 解析校验共用此元组。
MATCHED_FIELD_CONVERSATION_MESSAGES = "conversation_messages"
MATCHED_FIELD_CONVERSATION_SUMMARY = "conversation_summary"
MATCHED_FIELD_CANVAS_NODES = "canvas_nodes"
MATCHED_FIELD_PROJECT_METADATA = "project_metadata"
_MATCHED_FIELDS = (
    MATCHED_FIELD_CONVERSATION_MESSAGES,
    MATCHED_FIELD_CONVERSATION_SUMMARY,
    MATCHED_FIELD_CANVAS_NODES,
    MATCHED_FIELD_PROJECT_METADATA,
)


@dataclass(frozen=True)
class CreativeSkillActivation:
    """一次 Creative Skill 激活的不可变事实（契约 §1.3 / §4）。

    Java 在创建 AgentRun 时原子固定进 ``activated_creative_skill_versions``（0/1 单例）；
    Worker 在 claim 解析时按冻结 schema 强类型校验（身份 / 摘要 / source-reason 判别式）。
    ``resource_digest`` 是正文字节 SHA-256，读取正文时与响应 ``content_digest`` 双重比对
    （契约 §6）。本工单（T3）只消费 ``source=forced_use`` 正文；``auto`` 路径归 T5/T6。
    """

    creative_skill_id: str
    creative_skill_version_id: str
    source: str  # "forced_use" | "auto"
    reason: Mapping[str, Any]  # 判别式：forced_use→{type:user_use}；auto→{type:agent_match,detail:{matched_fields:[...]}}
    resource_digest: str


@dataclass(frozen=True)
class AutoCreativeSkillCandidate:
    """Run 创建时冻结的 auto 候选（契约 §1.4 / §3），不含正文。

    本工单（T3）只接收保留进 ``RunWork.auto_creative_skill_candidates``，不参与选择或
    激活（候选计算归 T5、Worker 选择归 T6）。``resource_digest`` 是正文字节摘要，供
    后续激活时与读取正文比对。
    """

    creative_skill_id: str
    creative_skill_version_id: str
    name: str
    description: str
    display_version: str
    resource_digest: str


@dataclass(frozen=True)
class ActivateCreativeSkillRequest:
    """auto 激活命令请求体（契约 §5 / ``ActivateCreativeSkillRequest``）。

    Worker 语义选择一个候选后构造：``expected_run_version`` 取激活前 Run version
    （乐观并发）；``reason`` 是 ``agent_match`` 结构化理由（``detail.matched_fields``
    非空去重枚举）。``idempotency_key`` + 载荷均确定性，支撑 §4.4 重放幂等。
    """

    idempotency_key: str
    expected_run_version: int
    creative_skill_id: str
    creative_skill_version_id: str
    reason: Mapping[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "idempotency_key": self.idempotency_key,
            "expected_run_version": self.expected_run_version,
            "creative_skill_id": self.creative_skill_id,
            "creative_skill_version_id": self.creative_skill_version_id,
            "reason": dict(self.reason),
        }


@dataclass(frozen=True)
class ActivateCreativeSkillResponse:
    """激活接纳响应（契约 §5 / ``ActivateCreativeSkillResponse``）。

    ``accepted`` 恒 ``true``（拒绝走标准错误通道，映射为 CreativeSkillActivationError）；
    ``activation`` 是 Java 已固定的权威激活记录（回写权威 ``resource_digest``）；
    ``run_version`` 是固定后的新 Run version，Worker 据此更新 work 流入流式管道。
    """

    accepted: bool
    activation: CreativeSkillActivation
    run_version: int


@dataclass(frozen=True)
class AutoCreativeSkillSelection:
    """auto 选择结果：封闭的零或一个候选（契约 §4.2）。

    不变量：``chosen is None`` 表示零选择（无语义匹配，正常基础生成，§4.2.4）；
    ``chosen`` 非空时 ``matched_fields`` 必非空（§4.3）。chosen 返回冻结的候选对象
    （而非模型原始数据），使 name / description / resource_digest 权威来自 Run pin。
    零选择与故障严格区分（§4.2.5）：故障经异常 fail closed，绝不伪装成零选择。
    """

    chosen: Optional[AutoCreativeSkillCandidate]
    matched_fields: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.chosen is not None and not self.matched_fields:
            raise ValueError("选定候选时 matched_fields 必须非空（契约 §4.3）")
        if self.chosen is None and self.matched_fields:
            raise ValueError("零选择不得携带 matched_fields（契约 §4.2.4）")


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
    # AgentRun 固定的 Runtime Bundle / ModelProfile pin（契约 §6）。Java 在创建 AgentRun
    # 时原子固定；enforcement-enabled=true 时下发，测试环境（enforcement-disabled）为 None。
    # Worker 按 bundle_version_id 拉取发布快照，用 manifest_digest 与本地重算值逐字节比对；
    # 字段不再被 claim 载荷解析丢弃。
    bundle_version_id: Optional[str] = None
    manifest_digest: Optional[str] = None
    model_profile_id: Optional[str] = None
    model_profile_version: Optional[str] = None
    # Creative Skill 激活 pin（契约 §3）：恒数组，不随 Skill 库发布漂移。
    # activated_creative_skill_versions 为 0/1 单例（forced_use 时 Java 原子固定当前发布
    # 版本）；auto_creative_skill_candidates 为 Run 创建时冻结的 auto 候选（T3 只接收不
    # 消费，选择归 T6）。Java 下发为 JSON 文本字符串（与 toolGrants 同形态），
    # enforcement-disabled 时不下发 → gateway 解析为空元组。claim 解析按冻结 schema 强类型
    # 校验，非法身份 / 摘要 / source-reason 判别式 / 超项 / 未知字段均 fail closed。
    # pin 随 RunWork 下发已由 Java 权威记录，Worker commit 不回传（ADR-0042 D2）。
    activated_creative_skill_versions: Sequence[CreativeSkillActivation] = ()
    auto_creative_skill_candidates: Sequence[AutoCreativeSkillCandidate] = ()
    # 当次 Run 钉住的 ToolGrant 子集（契约 §2.5）：Adapter 据此动态构造模型可见工具集，
    # 未授权工具对模型完全不可见。enforcement-disabled 时 Java 不下发，gateway 解析为空集。
    tool_grants: Sequence[ToolGrant] = ()
    # IK2QC8 紧凑初始上下文（契约 §6.1）：claim 下发的 Conversation 摘要与画布媒体节点。
    # conversation_summary 为摘要 Mapping 或 None（enforcement-disabled / 空 Conversation）；
    # canvas_nodes 为携带 assetId 的媒体节点摘要列表（无画布 / 无媒体节点 → 空集，合法）。
    # messages 语义收窄为「有界最近窗口」（末尾若干条），首轮仍含最新 user 消息。
    conversation_summary: Optional[Mapping[str, Any]] = None
    canvas_nodes: Sequence[Mapping[str, Any]] = ()


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
    async def advance(
        self,
        work: RunWork,
        *,
        stream_id: Optional[str] = None,
        emit_chunk: ChunkSink,
        f1_retry_prior_text: Optional[str] = None,
    ) -> OrchestratorResult:
        """根据权威工作包产生产品中性提案，不直接写产品状态。

        IK3BG3 流式形态：stream_id 是本回复流尝试的不透明标识（Worker 为每次新
        尝试分配，契约 §1.2）；可见文本经 ChunkFormer 成块后由 emit_chunk 逐块
        回调（必填：全部调用方都经分块协议提交）。f1_retry_prior_text
        非空表示 F1 纯动作重试轮：其值是上一轮混流文本的未放行尾部（Worker 按
        abort 响应的 released_sequence_no 截取，契约 §3.2 已放行前缀保留在
        aborted 消息中对用户可见，不得重复重放），先把它确定性重放进新尝试，
        再向模型追加「只输出工具调用、不输出可见文本」指令。
        """

    async def select_auto_creative_skill(self, work: RunWork) -> "AutoCreativeSkillSelection":
        """auto 选择的前置独立判定阶段（契约 §4.2）。

        输入 RunWork 的候选元数据 + 当次可见创作上下文信号（messages / 摘要 / 画布 /
        项目元数据），输出封闭的零或一个候选。程序不变量：``activated_creative_skill_versions``
        非空或候选空时短路返回零选择，不调用模型（§4.1.4 / §4.2.4）。模型语义判断后程序
        后置校验：所选 version_id 必须属于已冻结候选，返回冻结候选对象使身份 / 摘要权威；
        matched_fields 非空去重且取值属封闭枚举。零选择与故障严格区分（§4.2.5）。
        """


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

    def abort_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> Optional[Mapping[str, Any]]:
        """幂等 abort 一次回复流尝试（IK3GIM）：payload 携带 stream_id、
        ≤64 字符幂等键与规范化 reason_code；aborted 为不可重开终态。
        返回 AssistantMessageStreamResponse（含 released_sequence_no，
        契约 §3.1），Worker F1 路径据它截取未放行尾部。"""

    def activate_creative_skill(
        self, run_id: int, request: ActivateCreativeSkillRequest
    ) -> ActivateCreativeSkillResponse:
        """POST .../creative-skill-activations：auto 激活命令（契约 §5）。

        Java 校验幂等键 / Run version / 候选成员 / Run 尚未激活后原子固定激活记录并
        返回接纳响应（含权威 resource_digest 与固定后的 run_version）。确定性拒绝
        （NOT_A_CANDIDATE / KEY_REUSED / ALREADY_ACTIVATED 等）映射为
        CreativeSkillActivationError；Run 已终态 / 版本冲突映射为 AgentRunConflictError；
        其余 enveloped / 非 409 / 网络异常维持 RuntimeError（瞬态崩溃重试，契约 §8）。
        """


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


class CreativeContextSource(Protocol):
    """创作现场只读源（IK2QC7）：Worker 经它回溯当前 Run 绑定的画布 / 素材 / 生成任务 / 技能。

    与 ``ConversationSource`` 同根：端点以 runId 为根，Project 范围由 run 绑定闭环，
    ``JavaRunGateway`` 天然满足（duck-typed）。
    """

    def fetch_canvas_nodes(
        self, run_id: int, limit: Optional[int] = None
    ) -> Mapping[str, Any]:
        """读取当前 Project 画布的节点摘要列表（紧凑，限流）。"""

    def fetch_canvas_node(self, run_id: int, node_id: str) -> Mapping[str, Any]:
        """读取单个画布节点详情（含原始 data）。"""

    def fetch_asset(self, run_id: int, asset_id: int) -> Mapping[str, Any]:
        """读取单个 Asset 元数据（仅放行画布引用 ∪ 本 Run 产物范围）。"""

    def fetch_generation_job_status(
        self, run_id: int, job_id: int
    ) -> Mapping[str, Any]:
        """读取单个生成任务的紧凑状态。"""

    def fetch_creative_skills(self, run_id: int) -> Sequence[Mapping[str, Any]]:
        """读取 Run 固定 Bundle 快照里的 Creative Skill 紧凑元数据列表。"""


class CreativeSkillContentSource(Protocol):
    """已激活 Creative Skill 正文 / 引用资源只读源（契约 §6 / IK3NPD-T3）。

    按 ``run_id`` 寻址：Java 服务端从 Run pin 派生精确 Skill 与版本，客户端不能改读
    其他版本（恢复同一 Run 仍用同一 pin，不随 Skill 库发布漂移）。正文恒
    ``text/markdown``；引用资源按规范化 POSIX 相对路径返回单个。JavaRunGateway 天然
    满足（duck-typed）。与 ``CreativeContextSource.fetch_creative_skills``（推荐元数据，
    §7）区分：本源只服务于已激活版本的正文 / 引用按需读取。
    """

    def fetch_creative_skill_body(self, run_id: int) -> Mapping[str, Any]:
        """GET .../creative-skill-body：激活版本正文（含 content_digest，契约 §6）。"""

    def fetch_creative_skill_reference(
        self, run_id: int, resource_path: str
    ) -> Mapping[str, Any]:
        """GET .../creative-skill-references/{path}：单个引用资源（含 content_digest）。"""
