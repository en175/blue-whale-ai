"""Bundle 基础上下文装载器测试（工单 IK2QBJ）。

接缝一（IK2QBJ Testing Decisions）：内存 ``FakeBundleSource`` 覆盖装载器全部行为——
基础上下文装载、Skill 元数据披露、token 预算门、ModelProfile 能力门、fail closed。
"""

import unittest

from blue_whale_agent_worker.bundle.errors import (
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_SNAPSHOT_MALFORMED,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    MODEL_CAPABILITY_INSUFFICIENT,
    BundleError,
)
from blue_whale_agent_worker.bundle.loader import ContextLoader
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from blue_whale_agent_worker.bundle.verifier import VerifiedSnapshot

ROLE_BODY = "# 角色：蓝鲸创作导演\n你负责把用户创作意图推进到可生成。"
RULE_BODY = "规则：永远先确认风格与比例，再提出图片生成动作。"
SKILL_BODY = "# 创作工作流 Skill 正文\n1. 澄清 2. 提出动作。（按需正文，不进入初始上下文）"
SKILL_NAME = "root_skill"
SKILL_DESC = "根创作工作流"
MODEL_PROFILE_ID = "model_v2"
MODEL_VERSION = "2.0.0"


def _resource(resource_id, kind, load_mode, *, conflict_domain=None, metadata=None):
    resource = {
        "resourceId": resource_id,
        "revision": 1,
        "kind": kind,
        "path": f"{resource_id}.md",
        "mediaType": "text/markdown",
        "loadMode": load_mode,
        "contentDigest": "sha256:" + "0" * 64,
        "sizeBytes": 100,
        "tokenEstimate": 25,
        "references": [],
    }
    if conflict_domain is not None:
        resource["conflictDomain"] = conflict_domain
    if metadata is not None:
        resource["metadata"] = metadata
    return resource


def _resources():
    return [
        _resource("role_main", "role_document", "always_on"),
        _resource("rule_safety", "rule", "always_on", conflict_domain="safety"),
        _resource(
            "skill_root",
            "runtime_skill",
            "on_demand",
            metadata={
                "name": SKILL_NAME,
                "description": SKILL_DESC,
                "allowImplicitInvocation": False,
            },
        ),
    ]


def _make_snapshot(
    *,
    capabilities=("text", "tool_calling"),
    initial_max=1000,
    estimator="chars_div_4",
    model_profile_id=MODEL_PROFILE_ID,
    model_version=MODEL_VERSION,
):
    return {
        "bundleVersionId": "bv1",
        "version": "1.0.0",
        "composition": {
            "roleDocumentId": "role_main",
            "ruleSet": {"rules": ["rule_safety"]},
            "rootRuntimeSkillId": "skill_root",
            "modelProfiles": [
                {
                    "modelProfileId": model_profile_id,
                    "version": model_version,
                    "modelKey": "doubao-seed-1-6",
                    "capabilities": list(capabilities),
                    "maxInputTokens": 100000,
                    "maxOutputTokens": 4096,
                }
            ],
            "toolGrants": [],
            "tokenBudget": {
                "estimator": estimator,
                "initialContextMaxTokens": initial_max,
                "singleResourceMaxTokens": 1000,
                "activeContextMaxTokens": 4000,
            },
            "resourceManifest": {
                "formatVersion": 1,
                "baseUri": "bw-bundle://bv1/",
                "digestAlgorithm": "sha256",
                "manifestDigest": "sha256:" + "0" * 64,
                "resources": _resources(),
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
        "rule_safety": {"resource_id": "rule_safety", "content": RULE_BODY},
        "skill_root": {"resource_id": "skill_root", "content": SKILL_BODY},
    }
    if resources is not None:
        body = resources
    return FakeBundleSource(snapshots={"bv1": snapshot}, resources={"bv1": body})


def _chars_div_4(text):
    return 0 if not text else max(1, (len(text) + 3) // 4)


class ContextLoaderTest(unittest.TestCase):
    def test_load_assembles_role_rules_and_skill_metadata(self) -> None:
        snapshot = _make_snapshot()
        source = _source(snapshot)
        loader = ContextLoader(source)

        loaded = loader.load(_verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION)
        instructions = loaded.instructions

        self.assertIn(ROLE_BODY, instructions)
        self.assertIn(RULE_BODY, instructions)
        self.assertIn(SKILL_NAME, instructions)
        self.assertIn(SKILL_DESC, instructions)
        self.assertIn("allowImplicitInvocation", instructions)
        self.assertNotIn(SKILL_BODY, instructions)  # Skill 正文不进初始上下文
        # 只拉 always_on 正文（RoleDocument + 常驻 Rule），Skill 正文不拉
        self.assertEqual(2, source.resource_fetches)

    def test_load_rejects_profile_missing_tool_calling_before_fetch(self) -> None:
        snapshot = _make_snapshot(capabilities=("text",))
        source = _source(snapshot)
        loader = ContextLoader(source)

        with self.assertRaises(BundleError) as ctx:
            loader.load(_verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION)

        self.assertEqual(MODEL_CAPABILITY_INSUFFICIENT, ctx.exception.code)
        self.assertEqual(0, source.resource_fetches)  # 能力门在拉正文前 fail closed

    def test_load_rejects_unknown_profile_pin(self) -> None:
        snapshot = _make_snapshot()
        source = _source(snapshot)
        loader = ContextLoader(source)

        with self.assertRaises(BundleError) as ctx:
            loader.load(_verified(snapshot), "model_other", "9.9.9")

        self.assertEqual(BUNDLE_SNAPSHOT_MALFORMED, ctx.exception.code)

    def test_load_rejects_unsupported_token_estimator(self) -> None:
        snapshot = _make_snapshot(estimator="blue-whale-fancy-v1")
        source = _source(snapshot)
        loader = ContextLoader(source)

        with self.assertRaises(BundleError) as ctx:
            loader.load(_verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION)

        self.assertEqual(BUNDLE_SNAPSHOT_MALFORMED, ctx.exception.code)

    def test_load_rejects_missing_always_on_body(self) -> None:
        snapshot = _make_snapshot()
        source = FakeBundleSource(
            snapshots={"bv1": snapshot},
            resources={"bv1": {"rule_safety": {"content": RULE_BODY}}},  # 缺 role_main 正文
        )
        loader = ContextLoader(source)

        with self.assertRaises(BundleError) as ctx:
            loader.load(_verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION)

        self.assertEqual(BUNDLE_RESOURCE_UNKNOWN, ctx.exception.code)

    def test_initial_budget_gate_passes_at_limit_and_fails_when_exceeded(
        self,
    ) -> None:
        # 与 Java RuntimeBundleValidator.estimateTokens 逐字节一致：
        # always_on 正文按内容估算，Skill 元数据按 name + "\n" + description 估算。
        total = (
            _chars_div_4(ROLE_BODY)
            + _chars_div_4(RULE_BODY)
            + _chars_div_4(f"{SKILL_NAME}\n{SKILL_DESC}")
        )

        snapshot_ok = _make_snapshot(initial_max=total)
        ContextLoader(_source(snapshot_ok)).load(
            _verified(snapshot_ok), MODEL_PROFILE_ID, MODEL_VERSION
        )  # 恰好等于上限：不抛

        snapshot_tight = _make_snapshot(initial_max=total - 1)
        with self.assertRaises(BundleError) as ctx:
            ContextLoader(_source(snapshot_tight)).load(
                _verified(snapshot_tight), MODEL_PROFILE_ID, MODEL_VERSION
            )
        self.assertEqual(BUNDLE_TOKEN_BUDGET_EXCEEDED, ctx.exception.code)

    def test_load_produces_active_baseline_and_initial_evidence(self) -> None:
        # IK2QBM：load 产出活动基线 token（含 Skill 元数据）与 always_on initial 证据，
        # 作为 ResourceGate 的预算累计与账本起点。
        snapshot = _make_snapshot()
        source = _source(snapshot)
        loaded = ContextLoader(source).load(
            _verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION
        )

        expected_baseline = (
            _chars_div_4(ROLE_BODY)
            + _chars_div_4(RULE_BODY)
            + _chars_div_4(f"{SKILL_NAME}\n{SKILL_DESC}")
        )
        self.assertEqual(expected_baseline, loaded.initial_tokens)
        self.assertEqual(2, len(loaded.initial_evidence))  # role_main + rule_safety
        identities = {(e.resource_id, e.origin) for e in loaded.initial_evidence}
        self.assertEqual(
            {("role_main", "initial"), ("rule_safety", "initial")}, identities
        )

    def test_load_discloses_skill_reference_ids_and_counts_baseline(self) -> None:
        # IK2QBM acceptance #2：instructions 披露 Skill 已解析引用的 resourceId，
        # 模型据此逐层 read_resource；引用 resourceId 计入活动基线 token。
        snapshot = _make_snapshot()
        snapshot["composition"]["resourceManifest"]["resources"][2]["references"] = [
            {"rawRef": "ref.md", "resolvedResourceId": "ref_extra"}
        ]
        loaded = ContextLoader(_source(snapshot)).load(
            _verified(snapshot), MODEL_PROFILE_ID, MODEL_VERSION
        )

        self.assertIn("ref_extra", loaded.instructions)
        self.assertIn("reference resourceId", loaded.instructions)
        expected_baseline = (
            _chars_div_4(ROLE_BODY)
            + _chars_div_4(RULE_BODY)
            + _chars_div_4(f"{SKILL_NAME}\n{SKILL_DESC}")
            + _chars_div_4("ref_extra")
        )
        self.assertEqual(expected_baseline, loaded.initial_tokens)


if __name__ == "__main__":
    unittest.main()
