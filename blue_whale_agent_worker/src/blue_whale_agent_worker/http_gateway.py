import json
import re
from typing import Any, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .contracts import (
    AcceptedActionResult,
    AgentRunConflictError,
    AutoCreativeSkillCandidate,
    CreativeSkillActivation,
    RunWork,
    RuntimeCheckpoint,
    StreamAttemptExhaustedError,
    ToolGrant,
)

__all__ = [
    "AcceptedActionResult",
    "AgentRunConflictError",
    "JavaRunGateway",
    "RunWork",
    "RuntimeCheckpoint",
    "StreamAttemptExhaustedError",
    "ToolGrant",
    "run_work_from_payload",
]

# Java SystemCode.AGENT_RUN_CONFLICT（100303）：commit 因 expectedRunVersion / fencing token /
# 租约校验失败被拒——Run 已被新目标取代（superseded）或租约失效，Worker 应确定性退出。
AGENT_RUN_CONFLICT_CODE = 100303
# Java SystemCode.ASSISTANT_STREAM_ATTEMPT_EXHAUSTED（100305，IK3GIM）：同一 AgentRun 的
# 回复流尝试额度（2 次）已用尽——Worker 不得再次调用模型，应提交规范化失败。
ASSISTANT_STREAM_ATTEMPT_EXHAUSTED_CODE = 100305


def _optional_str(value: Any) -> Optional[str]:
    return str(value) if value is not None else None


def _envelope_code(detail: str) -> Optional[int]:
    """错误响应体是 Java 统一 Result 信封（{code, msg, data}）时解析业务码，用于
    409 的冲突分类；非信封（代理/网关原文）返回 None。"""
    try:
        envelope = json.loads(detail)
    except ValueError:
        return None
    if not isinstance(envelope, dict):
        return None
    code = envelope.get("code")
    return code if isinstance(code, int) else None


# Creative Skill 身份 / 摘要 / 名称 / 展示版本 pattern（与冻结 schema 同源，
# docs/specs/creative-skill-activation.schema.json）。claim 解析按此强类型校验。
_CREATIVE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{2,79}$")
_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_DISPLAY_VERSION_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
# auto reason.detail.matched_fields 的封闭枚举（契约 §4.3）。
_MATCHED_FIELDS = (
    "conversation_messages",
    "conversation_summary",
    "canvas_nodes",
    "project_metadata",
)


def _decode_creative_skill_array(raw: Any) -> list[Any]:
    """Java 下发为 JSON 文本字符串（与 toolGrants 同形态）；enforcement-disabled 时
    不下发（None / 缺省）→ 空数组。非数组类型 fail closed。"""
    if raw is None:
        return []
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, list):
        raise ValueError("Creative Skill 字段不是数组（契约 §3）")
    return parsed


def _parse_activations(raw: Any) -> tuple[CreativeSkillActivation, ...]:
    """``activated_creative_skill_versions`` 强类型解析（0/1 单例，契约 §3 maxItems:1）。

    非法身份 / 摘要 / source-reason 判别式 / 未知字段 / 超项均 raise → claim 冒泡崩溃
    重试（Java 违约防线，不降级、不静默丢弃）。
    """
    parsed = _decode_creative_skill_array(raw)
    if len(parsed) > 1:
        raise ValueError("activated_creative_skill_versions 超过单项（契约 §3 maxItems:1）")
    return tuple(_activation_from(item) for item in parsed)


def _activation_from(item: Any) -> CreativeSkillActivation:
    if not isinstance(item, dict):
        raise ValueError("Creative Skill 激活项不是对象")
    # additionalProperties: false — 恰好这 5 个键（冻结 schema 锁定）。
    if set(item.keys()) != {
        "creative_skill_id",
        "creative_skill_version_id",
        "source",
        "reason",
        "resource_digest",
    }:
        raise ValueError("Creative Skill 激活项字段不匹配冻结 schema")
    skill_id = item["creative_skill_id"]
    version_id = item["creative_skill_version_id"]
    source = item["source"]
    resource_digest = item["resource_digest"]
    if not (isinstance(skill_id, str) and _CREATIVE_ID_RE.match(skill_id)):
        raise ValueError("Creative Skill 身份非法")
    if not (isinstance(version_id, str) and _CREATIVE_ID_RE.match(version_id)):
        raise ValueError("Creative Skill 版本身份非法")
    if source not in ("forced_use", "auto"):
        raise ValueError("Creative Skill source 非法")
    if not (isinstance(resource_digest, str) and _DIGEST_RE.match(resource_digest)):
        raise ValueError("Creative Skill resource_digest 非法")
    _validate_activation_reason(source, item["reason"])
    return CreativeSkillActivation(
        creative_skill_id=skill_id,
        creative_skill_version_id=version_id,
        source=source,
        reason=dict(item["reason"]),
        resource_digest=resource_digest,
    )


def _validate_activation_reason(source: str, reason: Any) -> None:
    """reason 判别式（契约 §4.3）：type 必须与 source 一致，封闭对象禁止自由文本。"""
    if not isinstance(reason, dict):
        raise ValueError("Creative Skill reason 不是对象")
    if source == "forced_use":
        # ForcedUseReason：additionalProperties false，恰好 {type: user_use}。
        if set(reason.keys()) != {"type"} or reason.get("type") != "user_use":
            raise ValueError("forced_use reason 必须为 {type: user_use}")
        return
    # AutoMatchReason：{type: agent_match, detail: {matched_fields: [非空去重枚举]}}。
    if set(reason.keys()) != {"type", "detail"} or reason.get("type") != "agent_match":
        raise ValueError("auto reason 必须为 {type: agent_match, detail: {...}}")
    detail = reason.get("detail")
    if not isinstance(detail, dict) or set(detail.keys()) != {"matched_fields"}:
        raise ValueError("auto reason.detail 必须为 {matched_fields: [...]}")
    matched = detail.get("matched_fields")
    if not isinstance(matched, list) or not matched:
        raise ValueError("matched_fields 必须为非空数组")
    if len(set(matched)) != len(matched):
        raise ValueError("matched_fields 必须去重")
    if any(not isinstance(field, str) or field not in _MATCHED_FIELDS for field in matched):
        raise ValueError("matched_fields 取值非法")


def _parse_candidates(raw: Any) -> tuple[AutoCreativeSkillCandidate, ...]:
    """``auto_creative_skill_candidates`` 强类型解析（契约 §3，T3 只接收不消费）。"""
    parsed = _decode_creative_skill_array(raw)
    return tuple(_candidate_from(item) for item in parsed)


def _candidate_from(item: Any) -> AutoCreativeSkillCandidate:
    if not isinstance(item, dict):
        raise ValueError("Creative Skill 候选项不是对象")
    # additionalProperties: false — 禁止正文 / 未知字段（冻结 schema 锁定）。
    if set(item.keys()) != {
        "creative_skill_id",
        "creative_skill_version_id",
        "name",
        "description",
        "display_version",
        "resource_digest",
    }:
        raise ValueError("Creative Skill 候选项字段不匹配冻结 schema（禁止正文）")
    skill_id = item["creative_skill_id"]
    version_id = item["creative_skill_version_id"]
    name = item["name"]
    description = item["description"]
    display_version = item["display_version"]
    resource_digest = item["resource_digest"]
    if not (isinstance(skill_id, str) and _CREATIVE_ID_RE.match(skill_id)):
        raise ValueError("Creative Skill 候选身份非法")
    if not (isinstance(version_id, str) and _CREATIVE_ID_RE.match(version_id)):
        raise ValueError("Creative Skill 候选版本身份非法")
    if not (isinstance(name, str) and _SKILL_NAME_RE.match(name)):
        raise ValueError("Creative Skill 候选 name 非法")
    if not (isinstance(description, str) and 1 <= len(description) <= 1000):
        raise ValueError("Creative Skill 候选 description 长度非法")
    if not (isinstance(display_version, str) and _DISPLAY_VERSION_RE.match(display_version)):
        raise ValueError("Creative Skill 候选 display_version 非法")
    if not (isinstance(resource_digest, str) and _DIGEST_RE.match(resource_digest)):
        raise ValueError("Creative Skill 候选 resource_digest 非法")
    return AutoCreativeSkillCandidate(
        creative_skill_id=skill_id,
        creative_skill_version_id=version_id,
        name=name,
        description=description,
        display_version=display_version,
        resource_digest=resource_digest,
    )


def run_work_from_payload(data: dict[str, Any]) -> RunWork:
    checkpoint_data = data.get("checkpoint")
    checkpoint = None
    if checkpoint_data is not None:
        checkpoint = RuntimeCheckpoint(
            engine=str(checkpoint_data["engine"]),
            engine_version=str(checkpoint_data["engine_version"]),
            adapter_schema_version=int(checkpoint_data["adapter_schema_version"]),
            opaque_payload=dict(checkpoint_data["opaque_payload"]),
        )
    accepted_results = tuple(
        AcceptedActionResult(
            action_id=str(result["action_id"]),
            status=str(result["status"]),
            result=dict(result.get("result", {})),
        )
        for result in data.get("accepted_results", ())
    )
    return RunWork(
        agent_run_id=int(data["agent_run_id"]),
        project_id=int(data["project_id"]),
        conversation_id=int(data["conversation_id"]),
        user_id=int(data["user_id"]),
        run_version=int(data["run_version"]),
        fencing_token=int(data["fencing_token"]),
        engine=str(data["engine"]),
        engine_version=str(data["engine_version"]),
        adapter_schema_version=int(data["adapter_schema_version"]),
        messages=tuple(data.get("messages", ())),
        checkpoint=checkpoint,
        accepted_results=accepted_results,
        bundle_version_id=_optional_str(data.get("bundle_version_id")),
        manifest_digest=_optional_str(data.get("manifest_digest")),
        model_profile_id=_optional_str(data.get("model_profile_id")),
        model_profile_version=_optional_str(data.get("model_profile_version")),
        activated_creative_skill_versions=_parse_activations(
            data.get("activated_creative_skill_versions")
        ),
        auto_creative_skill_candidates=_parse_candidates(
            data.get("auto_creative_skill_candidates")
        ),
        tool_grants=_parse_tool_grants(data.get("tool_grants")),
        conversation_summary=data.get("conversation_summary"),
        canvas_nodes=tuple(data.get("canvas_nodes", ())),
    )


def _parse_tool_grants(raw: Any) -> tuple[ToolGrant, ...]:
    """Java 下发的 toolGrants 是 JSON 文本（与 activatedCreativeSkillVersions 同形态）；
    缺失或空集合法（纯文本对话）。逐项映射到 ToolGrant，字段缺失落入默认值，
    由 Orchestrator 的语义校验（工具不在注册表 / 版本漂移 / effect 不符）统一归一化为
    ORCHESTRATOR_CONTRACT_MISMATCH，不在 gateway 层抛未归一化异常。
    """
    if not raw:
        return ()
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    return tuple(
        ToolGrant(
            tool_name=str(item.get("toolName", "")),
            registry_version=int(item.get("registryVersion", 0)),
            effect=str(item.get("effect", "")),
            proposal_only=bool(item.get("proposalOnly", False)),
            argument_schema=dict(item.get("argumentSchema", {})),
            constraints=dict(item.get("constraints", {})),
        )
        for item in parsed
    )


class JavaRunGateway:
    def __init__(self, base_url: str, worker_id: str, orchestrator_engine: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._worker_id = worker_id
        self._orchestrator_engine = orchestrator_engine

    def claim(self) -> RunWork:
        data = self._request("/internal/agent-runs/claim", {})
        return run_work_from_payload(data)

    def commit(self, run_id: int, payload: dict[str, Any]) -> None:
        self._request(f"/internal/agent-runs/{run_id}/commits", payload)

    def start_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        self._request(
            f"/internal/agent-runs/{run_id}/assistant-messages/start", payload
        )

    def append_assistant_message_chunk(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        self._request(
            f"/internal/agent-runs/{run_id}/assistant-messages/chunks", payload
        )

    def complete_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> None:
        self._request(
            f"/internal/agent-runs/{run_id}/assistant-messages/complete", payload
        )

    def abort_assistant_message(
        self, run_id: int, payload: dict[str, Any]
    ) -> Optional[dict[str, Any]]:
        # 透出 AssistantMessageStreamResponse（含 released_sequence_no，契约 §3.1），
        # Worker F1 路径据它截取未放行尾部；传输层零新增，仅返回已有响应体。
        return self._request(
            f"/internal/agent-runs/{run_id}/assistant-messages/abort", payload
        )

    def fetch_snapshot(self, bundle_version_id: str) -> dict[str, Any]:
        """GET /internal/runtime-bundles/versions/{bundleVersionId}：整份发布快照（camelCase）。"""
        return self._request(
            f"/internal/runtime-bundles/versions/{bundle_version_id}", method="GET"
        )

    def fetch_resource(
        self, bundle_version_id: str, resource_id: str
    ) -> dict[str, Any]:
        """GET .../resources/{resourceId}：单资源正文（snake_case metadata + content）。"""
        return self._request(
            f"/internal/runtime-bundles/versions/{bundle_version_id}/resources/{resource_id}",
            method="GET",
        )

    def fetch_conversation_summary(self, run_id: int) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/conversation/summary：对话摘要（snake_case）。"""
        return self._request(
            f"/internal/agent-runs/{run_id}/conversation/summary", method="GET"
        )

    def fetch_conversation_history(
        self,
        run_id: int,
        after: Optional[int] = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/conversation/history：游标分页历史（snake_case）。"""
        query = f"?limit={limit}"
        if after is not None:
            query += f"&after={after}"
        return self._request(
            f"/internal/agent-runs/{run_id}/conversation/history{query}",
            method="GET",
        )

    def fetch_canvas_nodes(
        self, run_id: int, limit: Optional[int] = None
    ) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/canvas/nodes：画布节点摘要列表（snake_case）。"""
        query = f"?limit={limit}" if limit is not None else ""
        return self._request(
            f"/internal/agent-runs/{run_id}/canvas/nodes{query}", method="GET"
        )

    def fetch_canvas_node(self, run_id: int, node_id: str) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/canvas/nodes/{nodeId}：单节点详情（snake_case）。"""
        return self._request(
            f"/internal/agent-runs/{run_id}/canvas/nodes/{node_id}", method="GET"
        )

    def fetch_asset(self, run_id: int, asset_id: int) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/assets/{assetId}：Asset 元数据（snake_case）。"""
        return self._request(
            f"/internal/agent-runs/{run_id}/assets/{asset_id}", method="GET"
        )

    def fetch_generation_job_status(
        self, run_id: int, job_id: int
    ) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/generation-jobs/{jobId}/status：任务状态（snake_case）。"""
        return self._request(
            f"/internal/agent-runs/{run_id}/generation-jobs/{job_id}/status",
            method="GET",
        )

    def fetch_creative_skills(self, run_id: int) -> list[dict[str, Any]]:
        """GET /internal/agent-runs/{runId}/creative-skills：Creative Skill 元数据列表。"""
        return self._request(
            f"/internal/agent-runs/{run_id}/creative-skills", method="GET"
        )

    def fetch_creative_skill_body(self, run_id: int) -> dict[str, Any]:
        """GET /internal/agent-runs/{runId}/creative-skill-body：激活版本正文（契约 §6）。

        Java 按 runId 从 Run pin 派生固定版本，返回 ``CreativeSkillBodyResponse``
        （snake_case，含 ``content_digest``）。客户端不能改读其他版本。
        """
        return self._request(
            f"/internal/agent-runs/{run_id}/creative-skill-body", method="GET"
        )

    def fetch_creative_skill_reference(
        self, run_id: int, resource_path: str
    ) -> dict[str, Any]:
        """GET .../creative-skill-references/{resourcePath}：单个引用资源（契约 §6）。

        ``resource_path`` 为规范化 POSIX 相对路径（schema ResourcePath，仅 ``[A-Za-z0-9._-]``
        与 ``/``），直接拼路径无需 encode。返回 ``CreativeSkillReferenceResourceResponse``。
        """
        return self._request(
            f"/internal/agent-runs/{run_id}/creative-skill-references/{resource_path}",
            method="GET",
        )

    def _request(
        self,
        path: str,
        payload: Optional[dict[str, Any]] = None,
        method: str = "POST",
    ) -> Any:
        headers: dict[str, str] = {
            "Accept": "application/json",
            "X-Worker-Id": self._worker_id,
            "X-Orchestrator-Engine": self._orchestrator_engine,
        }
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self._base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8")
            envelope_code = _envelope_code(detail) if error.code == 409 else None
            # 仅 100303 / 100305 映射为专用冲突类型；其余 409（如 IDEMPOTENCY_KEY_REUSED）
            # 与其余 HTTP 错误维持崩溃重试。
            if envelope_code == AGENT_RUN_CONFLICT_CODE:
                raise AgentRunConflictError(
                    f"Java Product API 返回 HTTP 409（AGENT_RUN_CONFLICT）: {detail}"
                ) from error
            if envelope_code == ASSISTANT_STREAM_ATTEMPT_EXHAUSTED_CODE:
                raise StreamAttemptExhaustedError(
                    "Java Product API 返回 HTTP 409"
                    f"（ASSISTANT_STREAM_ATTEMPT_EXHAUSTED）: {detail}"
                ) from error
            raise RuntimeError(
                f"Java Product API 返回 HTTP {error.code}: {detail}"
            ) from error
        # list_creative_skills 等端点返回数组（data 为 list），其余为对象（dict）。
        if result.get("code") != 200 or not isinstance(result.get("data"), (dict, list)):
            raise RuntimeError(result.get("msg") or "Java Product API 拒绝请求")
        return result["data"]
