import unittest
from unittest.mock import patch
import io
import json
from urllib.error import HTTPError

from blue_whale_agent_worker.http_gateway import (
    AgentRunConflictError,
    JavaRunGateway,
    StreamAttemptExhaustedError,
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
        # 契约 §3/§6：AgentRun 固定 bundleVersionId / manifestDigest / modelProfile pin；
        # activated_creative_skill_versions 为 JSON 文本（与 toolGrants 同形态），Java 全局
        # Jackson SNAKE_CASE 下发，Worker 强类型解析为 CreativeSkillActivation（0/1 单例）。
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
                "activated_creative_skill_versions": json.dumps(
                    [
                        {
                            "creative_skill_id": "cs_poster_design",
                            "creative_skill_version_id": "csv_poster_design_1_0_0",
                            "source": "forced_use",
                            "reason": {"type": "user_use"},
                            "resource_digest": "sha256:" + "0" * 64,
                        }
                    ]
                ),
            }
        )
        self.assertEqual("pin_agent_v2_0_0", work.bundle_version_id)
        self.assertEqual(
            "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
            work.manifest_digest,
        )
        self.assertEqual("model_v2", work.model_profile_id)
        self.assertEqual("2.0.0", work.model_profile_version)
        # 强类型解析为 CreativeSkillActivation 单例；候选恒数组，缺省为空元组。
        self.assertEqual(1, len(work.activated_creative_skill_versions))
        activation = work.activated_creative_skill_versions[0]
        self.assertEqual("cs_poster_design", activation.creative_skill_id)
        self.assertEqual("csv_poster_design_1_0_0", activation.creative_skill_version_id)
        self.assertEqual("forced_use", activation.source)
        self.assertEqual({"type": "user_use"}, activation.reason)
        self.assertEqual("sha256:" + "0" * 64, activation.resource_digest)
        self.assertEqual((), work.auto_creative_skill_candidates)

    def test_run_work_bundle_pin_null_when_enforcement_disabled(self) -> None:
        # enforcement-disabled 时 Java 下发 null pin；Bundle pin 接收为 None，
        # Creative Skill pin 恒数组语义 → 空元组（无激活 / 无候选，不丢弃字段）。
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
        self.assertEqual((), work.activated_creative_skill_versions)
        self.assertEqual((), work.auto_creative_skill_candidates)

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


class CreativeSkillPinParsingTest(unittest.TestCase):
    """RunWork Creative Skill pin 强类型解析（契约 §3，IK3NPD-T3）。

    Java 下发 JSON 文本（与 toolGrants 同形态）；enforcement-disabled → null/缺省 → 空元组。
    合法 forced / auto 候选 / 空数组解析为强类型对象；非法（超项 / 字段缺失 / 非法身份 /
    摘要 / source-reason 判别式不符 / 候选携带正文）均在执行前 fail closed（raise → claim 冒泡）。
    """

    _BASE_PAYLOAD = {
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
    }

    @staticmethod
    def _forced_activation() -> dict:
        return {
            "creative_skill_id": "cs_poster_design",
            "creative_skill_version_id": "csv_poster_design_1_0_0",
            "source": "forced_use",
            "reason": {"type": "user_use"},
            "resource_digest": "sha256:" + "0" * 64,
        }

    @staticmethod
    def _auto_candidate() -> dict:
        return {
            "creative_skill_id": "cs_poster_design",
            "creative_skill_version_id": "csv_poster_design_1_0_0",
            "name": "poster-design",
            "description": "海报设计创作方法。",
            "display_version": "1.0.0",
            "resource_digest": "sha256:" + "0" * 64,
        }

    def _work(self, **overrides):
        return run_work_from_payload({**self._BASE_PAYLOAD, **overrides})

    def test_forced_activation_parses_strongly(self) -> None:
        work = self._work(
            activated_creative_skill_versions=json.dumps([self._forced_activation()])
        )
        self.assertEqual(1, len(work.activated_creative_skill_versions))
        act = work.activated_creative_skill_versions[0]
        self.assertEqual("cs_poster_design", act.creative_skill_id)
        self.assertEqual("forced_use", act.source)
        self.assertEqual({"type": "user_use"}, act.reason)

    def test_auto_candidate_preserved_not_consumed(self) -> None:
        # T3 只接收不消费：候选完整保留，激活数组空。
        work = self._work(
            auto_creative_skill_candidates=json.dumps([self._auto_candidate()])
        )
        self.assertEqual((), work.activated_creative_skill_versions)
        self.assertEqual(1, len(work.auto_creative_skill_candidates))
        cand = work.auto_creative_skill_candidates[0]
        self.assertEqual("poster-design", cand.name)
        self.assertEqual("1.0.0", cand.display_version)

    def test_empty_string_arrays_parse_to_empty_tuple(self) -> None:
        work = self._work(
            activated_creative_skill_versions="[]",
            auto_creative_skill_candidates="[]",
        )
        self.assertEqual((), work.activated_creative_skill_versions)
        self.assertEqual((), work.auto_creative_skill_candidates)

    def test_null_and_absent_parse_to_empty_tuple(self) -> None:
        # enforcement-disabled：null / 缺省 → 空元组（无激活 / 无候选），不 raise。
        work_null = self._work(
            activated_creative_skill_versions=None,
            auto_creative_skill_candidates=None,
        )
        work_absent = self._work()
        for work in (work_null, work_absent):
            self.assertEqual((), work.activated_creative_skill_versions)
            self.assertEqual((), work.auto_creative_skill_candidates)

    def test_second_activation_rejected(self) -> None:
        # maxItems:1 — 超过单项 fail closed。
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps(
                    [self._forced_activation(), self._forced_activation()]
                )
            )

    def test_activation_unknown_field_rejected(self) -> None:
        activation = self._forced_activation()
        activation["extra"] = "x"
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps([activation])
            )

    def test_activation_invalid_digest_rejected(self) -> None:
        activation = self._forced_activation()
        activation["resource_digest"] = "sha256:bad"
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps([activation])
            )

    def test_activation_invalid_identity_rejected(self) -> None:
        activation = self._forced_activation()
        activation["creative_skill_id"] = "UPPER"
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps([activation])
            )

    def test_forced_reason_free_text_rejected(self) -> None:
        # forced_use reason 封闭，禁止自由文本 / 额外键。
        activation = self._forced_activation()
        activation["reason"] = {"type": "user_use", "detail": "x"}
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps([activation])
            )

    def test_source_reason_mismatch_rejected(self) -> None:
        # forced_use source 配 auto reason → 判别式不符 fail closed。
        activation = self._forced_activation()
        activation["reason"] = {
            "type": "agent_match",
            "detail": {"matched_fields": ["canvas_nodes"]},
        }
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps([activation])
            )

    def test_candidate_carries_body_rejected(self) -> None:
        # 候选禁止正文（additionalProperties false）。
        candidate = self._auto_candidate()
        candidate["body"] = "正文"
        with self.assertRaises(ValueError):
            self._work(
                auto_creative_skill_candidates=json.dumps([candidate])
            )

    def test_non_array_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self._work(
                activated_creative_skill_versions=json.dumps({"not": "array"})
            )


class CreativeSkillContentFetchTest(unittest.TestCase):
    """§6 正文 / 引用资源 GET（契约 §6，IK3NPD-T3）：URL、X-Worker-Id、{code,data} 信封、snake_case。"""

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_fetch_creative_skill_body_get_url_and_snake_case_body(self, mocked_urlopen) -> None:
        body = {
            "creative_skill_id": "cs_poster_design",
            "creative_skill_version_id": "csv_poster_design_1_0_0",
            "media_type": "text/markdown",
            "body": "# 海报设计\n",
            "content_digest": "sha256:" + "0" * 64,
        }
        mocked_urlopen.return_value = FakeResponse(
            json.dumps({"code": 200, "data": body}).encode("utf-8")
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        fetched = gateway.fetch_creative_skill_body(23)

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(
            "http://java.test/internal/agent-runs/23/creative-skill-body",
            request.full_url,
        )
        self.assertEqual("GET", request.method)
        self.assertIsNone(request.data)
        self.assertEqual("# 海报设计\n", fetched["body"])
        self.assertEqual("text/markdown", fetched["media_type"])

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_fetch_creative_skill_reference_get_url_with_path(self, mocked_urlopen) -> None:
        resource = {
            "creative_skill_id": "cs_poster_design",
            "creative_skill_version_id": "csv_poster_design_1_0_0",
            "resource_path": "references/layout-checklist.md",
            "media_type": "text/markdown",
            "content": "- 对齐网格\n",
            "content_digest": "sha256:" + "1" * 64,
        }
        mocked_urlopen.return_value = FakeResponse(
            json.dumps({"code": 200, "data": resource}).encode("utf-8")
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        fetched = gateway.fetch_creative_skill_reference(23, "references/layout-checklist.md")

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(
            "http://java.test/internal/agent-runs/23/creative-skill-references/references/layout-checklist.md",
            request.full_url,
        )
        self.assertEqual("GET", request.method)
        self.assertEqual("- 对齐网格\n", fetched["content"])


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


class AbortContractTest(unittest.TestCase):
    """IK3GIM：abort 端点路径/载荷与 409 冲突分类（100303/100305/其余维持崩溃重试）。"""

    @staticmethod
    def _http_error(code: int, body: bytes) -> HTTPError:
        return HTTPError("http://java.test/x", code, "error", None, io.BytesIO(body))

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_abort_uses_java_product_api_path_and_payload(self, mocked_urlopen) -> None:
        mocked_urlopen.return_value = FakeResponse()
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")
        payload = {
            "stream_id": "stream-9",
            "idempotency_key": "abort-key",
            "reason_code": "CANCELLED",
        }

        gateway.abort_assistant_message(23, payload)

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(
            "http://java.test/internal/agent-runs/23/assistant-messages/abort",
            request.full_url,
        )
        body = json.loads(request.data)
        self.assertEqual("stream-9", body["stream_id"])
        self.assertEqual("abort-key", body["idempotency_key"])
        self.assertEqual("CANCELLED", body["reason_code"])

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_abort_conflict_409_maps_to_agent_run_conflict(self, mocked_urlopen) -> None:
        mocked_urlopen.side_effect = self._http_error(
            409,
            json.dumps(
                {"code": 100303, "msg": "AgentRun 提交绑定或版本无效", "data": None}
            ).encode("utf-8"),
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        with self.assertRaises(AgentRunConflictError):
            gateway.abort_assistant_message(23, {"stream_id": "stream-9"})

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_attempt_exhausted_409_maps_to_dedicated_error(self, mocked_urlopen) -> None:
        mocked_urlopen.side_effect = self._http_error(
            409,
            json.dumps(
                {"code": 100305, "msg": "回复流尝试额度已用尽", "data": None}
            ).encode("utf-8"),
        )
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")

        with self.assertRaises(StreamAttemptExhaustedError):
            gateway.start_assistant_message(23, {"stream_id": "stream-3"})

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_other_abort_errors_stay_crash_retry_runtime_error(self, mocked_urlopen) -> None:
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")
        cases = [
            # 同为 409 但非专用冲突码（如 IDEMPOTENCY_KEY_REUSED）维持崩溃重试
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
                    gateway.abort_assistant_message(23, {"stream_id": "stream-9"})
                self.assertNotIsInstance(caught.exception, AgentRunConflictError)
                self.assertNotIsInstance(caught.exception, StreamAttemptExhaustedError)


if __name__ == "__main__":
    unittest.main()
