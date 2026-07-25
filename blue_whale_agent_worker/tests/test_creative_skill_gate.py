import hashlib
import unittest

from blue_whale_agent_worker.bundle.errors import (
    CREATIVE_SKILL_CONTENT_MISSING,
    CREATIVE_SKILL_DIGEST_MISMATCH,
    BundleError,
)
from blue_whale_agent_worker.contracts import CreativeSkillActivation
from blue_whale_agent_worker.creative_skill_gate import (
    ORIGIN_CREATIVE_SKILL_BODY,
    ORIGIN_CREATIVE_SKILL_REFERENCE,
    CreativeSkillContentGate,
)

SKILL_ID = "cs_poster_design"
VERSION_ID = "csv_poster_design_1_0_0"
BODY = "# 海报设计\n\n1. 明确主题。\n2. 选择版式网格。\n"
REFERENCE = "- 对齐网格\n- 检查留白比例\n"


def _digest(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _activation(resource_digest: str = _digest(BODY)) -> CreativeSkillActivation:
    return CreativeSkillActivation(
        creative_skill_id=SKILL_ID,
        creative_skill_version_id=VERSION_ID,
        source="forced_use",
        reason={"type": "user_use"},
        resource_digest=resource_digest,
    )


class _FakeContentSource:
    """内存版 CreativeSkillContentSource：模拟 §6 正文 / 引用资源响应，记录拉取次数。"""

    def __init__(
        self,
        body: dict | None = None,
        references: dict[str, dict] | None = None,
        body_error: BaseException | None = None,
    ) -> None:
        self._body = body
        self._references = dict(references or {})
        self._body_error = body_error
        self.body_fetches = 0
        self.reference_fetches = 0

    def fetch_creative_skill_body(self, run_id: int) -> dict:
        self.body_fetches += 1
        if self._body_error is not None:
            raise self._body_error
        if self._body is None:
            raise KeyError("no body")
        return dict(self._body)

    def fetch_creative_skill_reference(self, run_id: int, resource_path: str) -> dict:
        self.reference_fetches += 1
        ref = self._references.get(resource_path)
        if ref is None:
            raise KeyError(resource_path)
        return dict(ref)


def _body_response(content_digest: str = _digest(BODY), media_type: str = "text/markdown") -> dict:
    return {
        "creative_skill_id": SKILL_ID,
        "creative_skill_version_id": VERSION_ID,
        "media_type": media_type,
        "body": BODY,
        "content_digest": content_digest,
    }


def _reference_response(path: str, content: str) -> dict:
    return {
        "creative_skill_id": SKILL_ID,
        "creative_skill_version_id": VERSION_ID,
        "resource_path": path,
        "media_type": "text/markdown",
        "content": content,
        "content_digest": _digest(content),
    }


class CreativeSkillBodyReadTest(unittest.TestCase):
    def test_read_body_returns_text_and_records_evidence(self) -> None:
        source = _FakeContentSource(body=_body_response())
        gate = CreativeSkillContentGate(source, _activation(), 23)

        body = gate.read_body()

        self.assertEqual(BODY, body)
        self.assertEqual(1, source.body_fetches)
        evidence = gate.evidence()
        self.assertEqual(1, len(evidence))
        self.assertEqual(ORIGIN_CREATIVE_SKILL_BODY, evidence[0].origin)
        self.assertEqual(_digest(BODY), evidence[0].content_digest)
        self.assertIn(SKILL_ID, evidence[0].resource_id)

    def test_read_body_is_idempotent_within_run(self) -> None:
        # 同 Run 正文字节不可变：重复读取命中缓存，只 GET 一次、不重算 digest。
        source = _FakeContentSource(body=_body_response())
        gate = CreativeSkillContentGate(source, _activation(), 23)

        self.assertEqual(BODY, gate.read_body())
        self.assertEqual(BODY, gate.read_body())

        self.assertEqual(1, source.body_fetches)
        self.assertEqual(1, len(gate.evidence()))

    def test_response_digest_mismatch_fail_closed(self) -> None:
        # 响应 content_digest 与实际字节不符 → DIGEST_MISMATCH。
        source = _FakeContentSource(body=_body_response(content_digest="sha256:" + "f" * 64))
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_pin_digest_mismatch_fail_closed(self) -> None:
        # 实际字节 == 响应摘要，但与 Run pin resource_digest 不符 → DIGEST_MISMATCH（不换版本）。
        source = _FakeContentSource(body=_body_response())
        gate = CreativeSkillContentGate(source, _activation(resource_digest="sha256:" + "a" * 64), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_response_identity_mismatch_fail_closed(self) -> None:
        body = _body_response()
        body["creative_skill_version_id"] = "csv_other"
        source = _FakeContentSource(body=body)
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_media_type_mismatch_fail_closed(self) -> None:
        source = _FakeContentSource(body=_body_response(media_type="text/plain"))
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_missing_body_fail_closed(self) -> None:
        body = _body_response()
        body["body"] = ""
        source = _FakeContentSource(body=body)
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_CONTENT_MISSING, caught.exception.code)

    def test_source_error_fail_closed_no_fallback(self) -> None:
        # 源端异常（字节缺失）→ CONTENT_MISSING，绝不回退默认提示词。
        source = _FakeContentSource(body_error=RuntimeError("upstream down"))
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_body()
        self.assertEqual(CREATIVE_SKILL_CONTENT_MISSING, caught.exception.code)


class CreativeSkillReferenceReadTest(unittest.TestCase):
    def test_read_reference_returns_content_and_records_evidence(self) -> None:
        path = "references/layout-checklist.md"
        source = _FakeContentSource(references={path: _reference_response(path, REFERENCE)})
        gate = CreativeSkillContentGate(source, _activation(), 23)

        content = gate.read_reference(path)

        self.assertEqual(REFERENCE, content)
        self.assertEqual(1, source.reference_fetches)
        evidence = gate.evidence()
        self.assertEqual(1, len(evidence))
        self.assertEqual(ORIGIN_CREATIVE_SKILL_REFERENCE, evidence[0].origin)
        self.assertIn(path, evidence[0].resource_id)

    def test_read_reference_digest_mismatch_fail_closed(self) -> None:
        path = "references/layout-checklist.md"
        ref = _reference_response(path, REFERENCE)
        ref["content_digest"] = "sha256:" + "e" * 64
        source = _FakeContentSource(references={path: ref})
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_reference(path)
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_read_reference_identity_path_mismatch_fail_closed(self) -> None:
        path = "references/layout-checklist.md"
        ref = _reference_response(path, REFERENCE)
        ref["resource_path"] = "other/path.md"
        source = _FakeContentSource(references={path: ref})
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_reference(path)
        self.assertEqual(CREATIVE_SKILL_DIGEST_MISMATCH, caught.exception.code)

    def test_read_reference_illegal_path_fail_closed(self) -> None:
        source = _FakeContentSource()
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_reference("../escape.md")
        self.assertEqual(CREATIVE_SKILL_CONTENT_MISSING, caught.exception.code)
        self.assertEqual(0, source.reference_fetches)  # 路径非法不发起请求

    def test_read_reference_missing_fail_closed(self) -> None:
        # 不存在的引用资源 → CONTENT_MISSING（契约：请求不存在的引用资源 fail closed）。
        source = _FakeContentSource(references={})
        gate = CreativeSkillContentGate(source, _activation(), 23)

        with self.assertRaises(BundleError) as caught:
            gate.read_reference("references/absent.md")
        self.assertEqual(CREATIVE_SKILL_CONTENT_MISSING, caught.exception.code)


if __name__ == "__main__":
    unittest.main()
