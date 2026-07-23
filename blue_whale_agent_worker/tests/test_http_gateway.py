import unittest
from unittest.mock import patch
import io
import json
from urllib.error import HTTPError

from blue_whale_agent_worker.http_gateway import (
    AgentRunConflictError,
    JavaRunGateway,
    run_work_from_payload,
)


class FakeResponse:
    def __init__(self, body: bytes = b'{"code":200,"data":{}}') -> None:
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self) -> bytes:
        return self._body


class RunWorkPayloadTest(unittest.TestCase):
    def test_checkpoint_and_accepted_results_stay_product_neutral(self) -> None:
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "pydantic-ai",
                "engine_version": "2.9.0",
                "adapter_schema_version": 1,
                "messages": [{"role": "user", "content": "生成一张蓝鲸海报"}],
                "checkpoint": {
                    "engine": "pydantic-ai",
                    "engine_version": "2.9.0",
                    "adapter_schema_version": 1,
                    "opaque_payload": {
                        "format": "pydantic-ai-v1",
                        "messages": [],
                        "pending_calls": [],
                    },
                },
                "accepted_results": [
                    {
                        "action_id": "pydantic-image-23-1",
                        "status": "succeeded",
                        "result": {"asset_ids": [91]},
                    }
                ],
            }
        )

        self.assertEqual("pydantic-ai", work.checkpoint.engine)
        self.assertEqual("pydantic-image-23-1", work.accepted_results[0].action_id)
        self.assertEqual({"asset_ids": [91]}, work.accepted_results[0].result)

    def test_run_work_carries_bundle_pin_fields(self) -> None:
        # 契约 §6：AgentRun 固定 bundleVersionId / manifestDigest / modelProfile pin /
        # activatedCreativeSkillVersions，Java 全局 Jackson SNAKE_CASE 下发为 snake_case。
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "pydantic-ai",
                "engine_version": "2.9.0",
                "adapter_schema_version": 1,
                "messages": [],
                "checkpoint": None,
                "bundle_version_id": "pin_agent_v2_0_0",
                "manifest_digest": "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
                "model_profile_id": "model_v2",
                "model_profile_version": "2.0.0",
                "activated_creative_skill_versions": [
                    {"creative_skill_id": "poster", "version_id": "poster_v1"}
                ],
            }
        )
        self.assertEqual("pin_agent_v2_0_0", work.bundle_version_id)
        self.assertEqual(
            "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
            work.manifest_digest,
        )
        self.assertEqual("model_v2", work.model_profile_id)
        self.assertEqual("2.0.0", work.model_profile_version)
        self.assertEqual(
            ({"creative_skill_id": "poster", "version_id": "poster_v1"},),
            work.activated_creative_skill_versions,
        )

    def test_run_work_bundle_pin_null_when_enforcement_disabled(self) -> None:
        # enforcement-enabled=false 时 Java 下发 null pin，Worker 接收为 None（不丢弃字段）。
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "fake",
                "engine_version": "1",
                "adapter_schema_version": 1,
                "messages": [],
                "checkpoint": None,
                "bundle_version_id": None,
                "manifest_digest": None,
                "model_profile_id": None,
                "model_profile_version": None,
                "activated_creative_skill_versions": None,
            }
        )
        self.assertIsNone(work.bundle_version_id)
        self.assertIsNone(work.manifest_digest)
        self.assertIsNone(work.model_profile_id)
        self.assertIsNone(work.model_profile_version)
        self.assertIsNone(work.activated_creative_skill_versions)

    def test_run_work_carries_compact_context_fields(self) -> None:
        # IK2QC8（契约 §6.1）：conversation_summary（dict）与 canvas_nodes（列表）从
        # snake_case 载荷正确解析；messages 现为有界最近窗口但仍原样解析。
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "pydantic-ai",
                "engine_version": "2.9.0",
                "adapter_schema_version": 1,
                "messages": [{"role": "user", "content": "生成海报"}],
                "checkpoint": None,
                "conversation_summary": {
                    "conversation_id": 11,
                    "message_count": 10,
                    "first_user_preview": "生成海报",
                    "last_message_preview": "msg-10",
                    "earliest_at": "2026-07-22T10:00:00",
                    "latest_at": "2026-07-22T11:00:00",
                },
                "canvas_nodes": [
                    {"node_id": "node-1", "type": "image", "asset_id": 77},
                ],
            }
        )
        self.assertEqual(10, work.conversation_summary["message_count"])
        self.assertEqual("生成海报", work.conversation_summary["first_user_preview"])
        self.assertEqual(1, len(work.canvas_nodes))
        self.assertEqual("node-1", work.canvas_nodes[0]["node_id"])
        self.assertEqual(77, work.canvas_nodes[0]["asset_id"])

    def test_run_work_compact_context_null_when_absent(self) -> None:
        # 字段缺失 / enforcement-disabled → conversation_summary=None，canvas_nodes=()。
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "fake",
                "engine_version": "1",
                "adapter_schema_version": 1,
                "messages": [],
                "checkpoint": None,
            }
        )
        self.assertIsNone(work.conversation_summary)
        self.assertEqual((), work.canvas_nodes)

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_streaming_methods_use_java_product_api_paths(self, mocked_urlopen) -> None:
        mocked_urlopen.return_value = FakeResponse()
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")
        payload = {"stream_id": "stream-1"}

        gateway.start_assistant_message(23, payload)
        gateway.append_assistant_message_chunk(23, payload)
        gateway.complete_assistant_message(23, payload)
        gateway.commit(23, {**payload, "assistant_message_stream_id": "stream-1"})

        requests = [call.args[0] for call in mocked_urlopen.call_args_list]
        self.assertEqual(
            [
                "http://java.test/internal/agent-runs/23/assistant-messages/start",
                "http://java.test/internal/agent-runs/23/assistant-messages/chunks",
                "http://java.test/internal/agent-runs/23/assistant-messages/complete",
                "http://java.test/internal/agent-runs/23/commits",
            ],
            [request.full_url for request in requests],
        )
        self.assertEqual(
            "stream-1", json.loads(requests[-1].data)["assistant_message_stream_id"]
        )


class BundleFetchContractTest(unittest.TestCase):
    """GET /internal/runtime-bundles/versions/... 契约：URL、X-Worker-Id、{code,data} 信封、camelCase 快照。"""

    @staticmethod
    def _snapshot_envelope() -> bytes:
        snapshot = {
            "bundleVersionId": "pin_agent_v2_0_0",
            "composition": {
                "resourceManifest": {
                    "formatVersion": 1,
                    "baseUri": "bw-bundle://pin_agent_v2_0_0/",
                    "digestAlgorithm": "sha256",
                    "resources": [],
                    "manifestDigest": "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
                },
                "modelProfiles": [
                    {"modelProfileId": "model_v2", "version": "2.0.0"}
                ],
            },
        }
        return json.dumps({"code": 200, "data": snapshot}).encode("utf-8")

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_fetch_snapshot_get_url_worker_header_and_camel_case_envelope(
        self, mocked_urlopen
    ) -> None:
        mocked_urlopen.return_value = FakeResponse(self._snapshot_envelope())
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        snapshot = gateway.fetch_snapshot("pin_agent_v2_0_0")

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(
            "http://java.test/internal/runtime-bundles/versions/pin_agent_v2_0_0",
            request.full_url,
        )
        self.assertEqual("GET", request.method)
        # urllib Request 以 capitalize 后的头名存储（X-Worker-Id → X-worker-id）
        self.assertEqual("worker-1", request.get_header("X-worker-id"))
        self.assertIsNone(request.data)  # GET 无 body
        # camelCase 快照原样解析（不转 snake_case，区别于 RunWork 载荷）
        self.assertEqual("pin_agent_v2_0_0", snapshot["bundleVersionId"])
        self.assertEqual(
            "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
            snapshot["composition"]["resourceManifest"]["manifestDigest"],
        )

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_fetch_snapshot_rejects_non_ok_envelope(self, mocked_urlopen) -> None:
        mocked_urlopen.return_value = FakeResponse(
            json.dumps(
                {"code": 404, "msg": "version not found", "data": None}
            ).encode("utf-8")
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        with self.assertRaises(RuntimeError):
            gateway.fetch_snapshot("missing_version")

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_fetch_resource_get_url_worker_header_and_resource_body(
        self, mocked_urlopen
    ) -> None:
        resource = {
            "resource_id": "role_main",
            "revision": 1,
            "kind": "role_document",
            "content_digest": "sha256:" + "0" * 64,
            "content": "# Role\n",
        }
        mocked_urlopen.return_value = FakeResponse(
            json.dumps({"code": 200, "data": resource}).encode("utf-8")
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        fetched = gateway.fetch_resource("pin_agent_v2_0_0", "role_main")

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(
            "http://java.test/internal/runtime-bundles/versions/pin_agent_v2_0_0/resources/role_main",
            request.full_url,
        )
        self.assertEqual("GET", request.method)
        self.assertEqual("worker-1", request.get_header("X-worker-id"))
        self.assertIsNone(request.data)  # GET 无 body
        # 单资源响应为 snake_case metadata + content
        self.assertEqual("# Role\n", fetched["content"])
        self.assertEqual("role_main", fetched["resource_id"])


class CommitConflictClassificationTest(unittest.TestCase):
    """IK3BG2：409/AGENT_RUN_CONFLICT 映射为专用冲突错误类型，与其余 RuntimeError 区分。"""

    @staticmethod
    def _http_error(code: int, body: bytes) -> HTTPError:
        return HTTPError("http://java.test/x", code, "error", None, io.BytesIO(body))

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_agent_run_conflict_409_maps_to_dedicated_error(self, mocked_urlopen) -> None:
        mocked_urlopen.side_effect = self._http_error(
            409,
            json.dumps(
                {"code": 100303, "msg": "AgentRun 状态冲突", "data": None}
            ).encode("utf-8"),
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        with self.assertRaises(AgentRunConflictError):
            gateway.commit(23, {"commit_id": "c-1"})

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_other_http_errors_stay_crash_retry_runtime_error(self, mocked_urlopen) -> None:
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")
        cases = [
            # 同为 409 但非 AGENT_RUN_CONFLICT（如 IDEMPOTENCY_KEY_REUSED）维持崩溃重试
            self._http_error(
                409,
                json.dumps({"code": 100302, "msg": "idempotency", "data": None}).encode("utf-8"),
            ),
            # 非 409 状态码
            self._http_error(500, b"oops"),
            # 409 但响应体非 JSON 信封（代理/网关原文）
            self._http_error(409, b"<html>proxy</html>"),
        ]
        for error in cases:
            with self.subTest(error=error.code):
                mocked_urlopen.side_effect = error
                with self.assertRaises(RuntimeError) as caught:
                    gateway.commit(23, {"commit_id": "c-1"})
                self.assertNotIsInstance(caught.exception, AgentRunConflictError)


if __name__ == "__main__":
    unittest.main()
