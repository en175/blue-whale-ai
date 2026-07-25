"""受限资源读取闸门测试（工单 IK2QBM）。

接缝一（IK2QBM Testing Decisions）：内存 ``FakeBundleSource`` 覆盖闸门全部行为——
按 resolvedResourceId 读取、digest 重算比对、单资源与活动上下文双预算门、
fail closed 分支（未知 / 篡改 / 单资源超限 / 活动超限）、恢复重建、读取证据记账。
"""

import hashlib
import unittest

from blue_whale_agent_worker.bundle.errors import (
    BUNDLE_RESOURCE_DIGEST_MISMATCH,
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    BundleError,
)
from blue_whale_agent_worker.bundle.gate import ReadEvidence, ResourceGate
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from blue_whale_agent_worker.bundle.tokens import estimate_chars_div_4
from blue_whale_agent_worker.bundle.verifier import VerifiedSnapshot

BUNDLE_VERSION_ID = "pin_agent_v2_0_0"

ROLE_BODY = "# 角色：蓝鲸创作导演\n你负责推进创作意图。"
SKILL_BODY = "# 根创作工作流\n1. 澄清意图 2. 提出生图动作。"
REF_BODY = "# 安全规则\n生成前必须确认比例与风格。"
SKILL_NAME = "root_skill"
SKILL_DESC = "根创作工作流"


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _resource(
    resource_id,
    kind,
    load_mode,
    *,
    content_digest,
    references=None,
    metadata=None,
    token_estimate=25,
):
    resource = {
        "resourceId": resource_id,
        "revision": 1,
        "kind": kind,
        "path": f"{resource_id}.md",
        "mediaType": "text/markdown",
        "loadMode": load_mode,
        "contentDigest": content_digest,
        "sizeBytes": 100,
        "tokenEstimate": token_estimate,
        "references": references or [],
    }
    if metadata is not None:
        resource["metadata"] = metadata
    return resource


def _manifest_resources():
    return [
        _resource(
            "role_main",
            "role_document",
            "always_on",
            content_digest=_sha256(ROLE_BODY),
            token_estimate=estimate_chars_div_4(ROLE_BODY),
        ),
        _resource(
            "skill_root",
            "runtime_skill",
            "on_demand",
            content_digest=_sha256(SKILL_BODY),
            metadata={
                "name": SKILL_NAME,
                "description": SKILL_DESC,
                "allowImplicitInvocation": False,
            },
            references=[{"rawRef": "ref.md", "resolvedResourceId": "ref_rule"}],
            token_estimate=estimate_chars_div_4(SKILL_BODY),
        ),
        _resource(
            "ref_rule",
            "rule",
            "on_demand",
            content_digest=_sha256(REF_BODY),
            token_estimate=estimate_chars_div_4(REF_BODY),
        ),
    ]


def _make_snapshot(*, single_max=1000, active_max=4000):
    return {
        "bundleVersionId": BUNDLE_VERSION_ID,
        "version": "1.0.0",
        "composition": {
            "resourceManifest": {
                "formatVersion": 1,
                "baseUri": f"bw-bundle://{BUNDLE_VERSION_ID}/",
                "digestAlgorithm": "sha256",
                "manifestDigest": "sha256:" + "0" * 64,
                "resources": _manifest_resources(),
            },
            "tokenBudget": {
                "estimator": "chars_div_4",
                "initialContextMaxTokens": 1000,
                "singleResourceMaxTokens": single_max,
                "activeContextMaxTokens": active_max,
            },
        },
    }


def _verified(snapshot):
    return VerifiedSnapshot(
        bundle_version_id=snapshot["bundleVersionId"],
        manifest_digest=snapshot["composition"]["resourceManifest"]["manifestDigest"],
        snapshot=snapshot,
    )


def _source(snapshot, *, resources=None):
    body = {
        "role_main": {"resource_id": "role_main", "content": ROLE_BODY},
        "skill_root": {"resource_id": "skill_root", "content": SKILL_BODY},
        "ref_rule": {"resource_id": "ref_rule", "content": REF_BODY},
    }
    if resources is not None:
        body = resources
    return FakeBundleSource(snapshots={BUNDLE_VERSION_ID: snapshot}, resources={BUNDLE_VERSION_ID: body})


def _initial_baseline_tokens():
    # active 基线 = always_on 正文 + Skill 元数据（与 ContextLoader 装载口径一致）
    return estimate_chars_div_4(ROLE_BODY) + estimate_chars_div_4(
        f"{SKILL_NAME}\n{SKILL_DESC}"
    )


def _initial_evidence():
    return (
        ReadEvidence(
            resource_id="role_main",
            revision=1,
            content_digest=_sha256(ROLE_BODY),
            token_estimate=estimate_chars_div_4(ROLE_BODY),
            origin="initial",
        ),
    )


def _gate(snapshot=None, *, source=None, initial_tokens=None, single_max=1000, active_max=4000):
    snapshot = snapshot or _make_snapshot(single_max=single_max, active_max=active_max)
    source = source or _source(snapshot)
    return ResourceGate(
        _verified(snapshot),
        source,
        initial_tokens=(
            _initial_baseline_tokens() if initial_tokens is None else initial_tokens
        ),
        initial_evidence=_initial_evidence(),
    )


class ResourceGateReadTest(unittest.TestCase):
    def test_read_on_demand_resource_returns_content_and_records_evidence(self) -> None:
        gate = _gate()

        content = gate.read("ref_rule")

        self.assertEqual(REF_BODY, content)
        evidence = gate.evidence()
        on_demand = [e for e in evidence if e.origin == "on_demand"]
        self.assertEqual(1, len(on_demand))
        self.assertEqual("ref_rule", on_demand[0].resource_id)
        self.assertEqual(_sha256(REF_BODY), on_demand[0].content_digest)
        self.assertEqual(estimate_chars_div_4(REF_BODY), on_demand[0].token_estimate)

    def test_read_unknown_resource_id_fails_closed(self) -> None:
        gate = _gate()

        with self.assertRaises(BundleError) as ctx:
            gate.read("not_in_manifest")

        self.assertEqual(BUNDLE_RESOURCE_UNKNOWN, ctx.exception.code)

    def test_read_tampered_content_fails_closed_on_digest_mismatch(self) -> None:
        snapshot = _make_snapshot()
        # manifest contentDigest 锁定的是 REF_BODY 的摘要；源端返回被篡改正文。
        tampered_source = _source(
            snapshot,
            resources={
                "role_main": {"resource_id": "role_main", "content": ROLE_BODY},
                "skill_root": {"resource_id": "skill_root", "content": SKILL_BODY},
                "ref_rule": {"resource_id": "ref_rule", "content": "被篡改的规则正文"},
            },
        )
        gate = _gate(snapshot=snapshot, source=tampered_source)

        with self.assertRaises(BundleError) as ctx:
            gate.read("ref_rule")

        self.assertEqual(BUNDLE_RESOURCE_DIGEST_MISMATCH, ctx.exception.code)

    def test_read_single_resource_budget_exceeded_fails_closed(self) -> None:
        # singleResourceMaxTokens 卡到比 ref_rule 正文估算更小：超限即拒，不截断。
        gate = _gate(single_max=estimate_chars_div_4(REF_BODY) - 1)

        with self.assertRaises(BundleError) as ctx:
            gate.read("ref_rule")

        self.assertEqual(BUNDLE_TOKEN_BUDGET_EXCEEDED, ctx.exception.code)

    def test_read_active_context_budget_exceeded_includes_initial_baseline(self) -> None:
        # active 门含初始基线：把 active_max 卡到 初始基线 + 1，ref_rule 一读即超。
        baseline = _initial_baseline_tokens()
        gate = _gate(active_max=baseline + 1)

        with self.assertRaises(BundleError) as ctx:
            gate.read("ref_rule")

        self.assertEqual(BUNDLE_TOKEN_BUDGET_EXCEEDED, ctx.exception.code)

    def test_read_already_charged_initial_resource_does_not_double_count(self) -> None:
        # always_on 资源已在初始基线记账：模型再次 read 不重复计 token，仍返回正文。
        gate = _gate()
        active_before = gate.active_tokens

        content = gate.read("role_main")

        self.assertEqual(ROLE_BODY, content)
        self.assertEqual(active_before, gate.active_tokens)
        on_demand = [e for e in gate.evidence() if e.origin == "on_demand"]
        self.assertEqual(0, len(on_demand))

    def test_read_same_on_demand_resource_twice_fetches_once_and_no_double_count(self) -> None:
        snapshot = _make_snapshot()
        source = _source(snapshot)
        gate = _gate(snapshot=snapshot, source=source)

        gate.read("ref_rule")
        active_after_first = gate.active_tokens
        fetches_after_first = source.resource_fetches

        gate.read("ref_rule")

        self.assertEqual(active_after_first, gate.active_tokens)
        self.assertEqual(fetches_after_first, source.resource_fetches)

    def test_read_resource_missing_content_fails_closed(self) -> None:
        # 源端返回的资源 dict 缺 content：按需资源缺少正文 → BUNDLE_RESOURCE_UNKNOWN。
        snapshot = _make_snapshot()
        source = _source(
            snapshot,
            resources={
                "role_main": {"resource_id": "role_main", "content": ROLE_BODY},
                "skill_root": {"resource_id": "skill_root", "content": SKILL_BODY},
                "ref_rule": {"resource_id": "ref_rule"},  # 无正文
            },
        )
        gate = _gate(snapshot=snapshot, source=source)

        with self.assertRaises(BundleError) as ctx:
            gate.read("ref_rule")

        self.assertEqual(BUNDLE_RESOURCE_UNKNOWN, ctx.exception.code)

    def test_source_exception_fails_closed(self) -> None:
        # 资源登记在 manifest 但源端取不到（fetch_resource 抛异常）→ fail closed。
        snapshot = _make_snapshot()
        source = _source(
            snapshot,
            resources={
                "role_main": {"resource_id": "role_main", "content": ROLE_BODY},
                "skill_root": {"resource_id": "skill_root", "content": SKILL_BODY},
                # ref_rule 登记在 manifest 但源端无条目 → fetch_resource 抛 KeyError
            },
        )
        gate = _gate(snapshot=snapshot, source=source)

        with self.assertRaises(BundleError) as ctx:
            gate.read("ref_rule")

        self.assertEqual(BUNDLE_RESOURCE_UNKNOWN, ctx.exception.code)


class ResourceGateReplayTest(unittest.TestCase):
    def test_register_from_history_rebuilds_ledger_with_history_origin(self) -> None:
        gate = _gate()

        gate.register_from_history("ref_rule")

        history = [e for e in gate.evidence() if e.origin == "history"]
        self.assertEqual(1, len(history))
        self.assertEqual("ref_rule", history[0].resource_id)
        self.assertEqual(_sha256(REF_BODY), history[0].content_digest)

    def test_register_from_history_skips_unknown_and_already_charged(self) -> None:
        gate = _gate()
        gate.register_from_history("ref_rule")
        active_after = gate.active_tokens

        gate.register_from_history("not_in_manifest")  # 未知：跳过，不抛
        gate.register_from_history("ref_rule")  # 已记账：跳过

        self.assertEqual(active_after, gate.active_tokens)

    def test_register_from_history_exceeding_active_fails_closed(self) -> None:
        baseline = _initial_baseline_tokens()
        gate = _gate(active_max=baseline + estimate_chars_div_4(REF_BODY) - 1)

        with self.assertRaises(BundleError) as ctx:
            gate.register_from_history("ref_rule")

        self.assertEqual(BUNDLE_TOKEN_BUDGET_EXCEEDED, ctx.exception.code)

    def test_register_then_read_does_not_double_count(self) -> None:
        # 恢复重建后，同一资源模型再次 read 不重复计 token（恢复不是侧门）。
        gate = _gate()
        gate.register_from_history("ref_rule")
        active_after_register = gate.active_tokens

        content = gate.read("ref_rule")

        self.assertEqual(REF_BODY, content)
        self.assertEqual(active_after_register, gate.active_tokens)


class ResourceGateErrorHygieneTest(unittest.TestCase):
    def test_error_messages_do_not_leak_snapshot_body_or_private_path(self) -> None:
        gate = _gate()

        with self.assertRaises(BundleError) as ctx:
            gate.read("not_in_manifest")

        message = ctx.exception.message
        self.assertNotIn(ROLE_BODY, message)
        self.assertNotIn("bw-bundle://", message)


if __name__ == "__main__":
    unittest.main()
