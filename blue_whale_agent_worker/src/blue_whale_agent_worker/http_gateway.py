import json
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .contracts import AcceptedActionResult, RunWork, RuntimeCheckpoint


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

    def _request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            f"{self._base_url}{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Worker-Id": self._worker_id,
                "X-Orchestrator-Engine": self._orchestrator_engine,
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8")
            raise RuntimeError(
                f"Java Product API 返回 HTTP {error.code}: {detail}"
            ) from error
        if result.get("code") != 200 or not isinstance(result.get("data"), dict):
            raise RuntimeError(result.get("msg") or "Java Product API 拒绝请求")
        return result["data"]
