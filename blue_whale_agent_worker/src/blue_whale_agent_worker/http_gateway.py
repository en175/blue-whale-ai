import json
from typing import Any, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .contracts import AcceptedActionResult, RunWork, RuntimeCheckpoint, ToolGrant


def _optional_str(value: Any) -> Optional[str]:
    return str(value) if value is not None else None


def _optional_seq(value: Any) -> Optional[tuple[Any, ...]]:
    if value is None:
        return None
    return tuple(value)


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
        activated_creative_skill_versions=_optional_seq(
            data.get("activated_creative_skill_versions")
        ),
        tool_grants=_parse_tool_grants(data.get("tool_grants")),
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
            raise RuntimeError(
                f"Java Product API 返回 HTTP {error.code}: {detail}"
            ) from error
        # list_creative_skills 等端点返回数组（data 为 list），其余为对象（dict）。
        if result.get("code") != 200 or not isinstance(result.get("data"), (dict, list)):
            raise RuntimeError(result.get("msg") or "Java Product API 拒绝请求")
        return result["data"]
