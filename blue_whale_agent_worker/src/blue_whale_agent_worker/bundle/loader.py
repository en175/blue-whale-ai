"""Runtime Agent Bundle 基础上下文装载器（契约 §6 / IK2QBJ）。

消费 ``BundleVerifier`` 校验通过的 ``VerifiedSnapshot``，按 always_on 装载基础上下文
（RoleDocument + always_on Rules 正文 + 全部 RuntimeSkill 元数据），拼成 Agent 初始
instructions，并过 ``initialContextMaxTokens`` 预算门。Skill 正文不进入初始上下文
（按需 ``read_resource`` 由 sibling IK2QBM 承接）。

token 估算按快照 ``TokenBudget.estimator`` 执行（当前仅 ``chars_div_4``），与 Java 发布侧
``RuntimeBundleValidator.estimateTokens`` 逐字节一致：空串 0，否则 ``max(1, (len + 3) // 4)``；
Skill 元数据估算对象为 ``name + "\\n" + description``（对齐 Java 预算校验）。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .errors import (
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_SNAPSHOT_MALFORMED,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    MODEL_CAPABILITY_INSUFFICIENT,
    BundleError,
)
from .source import BundleSource
from .verifier import VerifiedSnapshot

LOAD_ALWAYS_ON = "always_on"
KIND_ROLE_DOCUMENT = "role_document"
KIND_RULE = "rule"
KIND_RUNTIME_SKILL = "runtime_skill"

# 契约 §2.4：运行 Agent 需要 tool_calling 才能提议受限工具动作。
REQUIRED_CAPABILITIES = frozenset({"tool_calling"})
SUPPORTED_TOKEN_ESTIMATOR = "chars_div_4"


def _estimate_chars_div_4(text: str) -> int:
    return 0 if not text else max(1, (len(text) + 3) // 4)


def _skill_metadata(skill: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = skill.get("metadata")
    return metadata if isinstance(metadata, Mapping) else {}


class ContextLoader:
    """按 Run pin 的 BundleVersion 装载基础上下文，产出 Agent 初始 instructions。"""

    def __init__(self, source: BundleSource) -> None:
        self._source = source

    def load(
        self,
        verified: VerifiedSnapshot,
        model_profile_id: str,
        model_profile_version: str,
    ) -> str:
        composition = verified.snapshot.get("composition")
        if not isinstance(composition, Mapping):
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "发布快照缺少 composition")

        self._require_token_estimator(composition)
        profile = self._select_profile(composition, model_profile_id, model_profile_version)
        self._require_capabilities(profile)  # 能力门在拉正文前 fail closed

        manifest = composition.get("resourceManifest")
        resources = (
            manifest.get("resources", ()) if isinstance(manifest, Mapping) else ()
        )
        role, always_rules, skills = self._partition_resources(resources)

        bundle_version_id = verified.bundle_version_id
        role_body = self._fetch_body(bundle_version_id, role)
        rule_bodies = [self._fetch_body(bundle_version_id, rule) for rule in always_rules]
        instructions = self._render_instructions(role_body, rule_bodies, skills)

        self._enforce_initial_budget(composition, role_body, rule_bodies, skills)
        return instructions

    @staticmethod
    def _require_token_estimator(composition: Mapping[str, Any]) -> None:
        budget = composition.get("tokenBudget")
        if not isinstance(budget, Mapping):
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "发布快照缺少 tokenBudget")
        if budget.get("estimator") != SUPPORTED_TOKEN_ESTIMATOR:
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "不支持的 token 估算器")

    @staticmethod
    def _select_profile(
        composition: Mapping[str, Any], profile_id: str, profile_version: str
    ) -> Mapping[str, Any]:
        profiles = composition.get("modelProfiles")
        if isinstance(profiles, list):
            for profile in profiles:
                if (
                    isinstance(profile, Mapping)
                    and profile.get("modelProfileId") == profile_id
                    and profile.get("version") == profile_version
                ):
                    return profile
        raise BundleError(
            BUNDLE_SNAPSHOT_MALFORMED, "AgentRun 固定的 ModelProfile 不在发布快照内"
        )

    @staticmethod
    def _require_capabilities(profile: Mapping[str, Any]) -> None:
        capabilities = profile.get("capabilities")
        declared = set(capabilities) if isinstance(capabilities, list) else set()
        missing = REQUIRED_CAPABILITIES - declared
        if missing:
            raise BundleError(MODEL_CAPABILITY_INSUFFICIENT, "ModelProfile 缺少必需能力")

    @staticmethod
    def _partition_resources(resources: Any) -> tuple[
        Mapping[str, Any], list[Mapping[str, Any]], list[Mapping[str, Any]]
    ]:
        role: Mapping[str, Any] | None = None
        always_rules: list[Mapping[str, Any]] = []
        skills: list[Mapping[str, Any]] = []
        for resource in resources:
            if not isinstance(resource, Mapping):
                continue
            kind = resource.get("kind")
            if kind == KIND_ROLE_DOCUMENT:
                role = resource
            elif kind == KIND_RULE and resource.get("loadMode") == LOAD_ALWAYS_ON:
                always_rules.append(resource)
            elif kind == KIND_RUNTIME_SKILL:
                skills.append(resource)
        if role is None:
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "发布快照缺少 RoleDocument")
        return role, always_rules, skills

    def _fetch_body(self, bundle_version_id: str, resource: Mapping[str, Any]) -> str:
        resource_id = resource.get("resourceId")
        try:
            body = self._source.fetch_resource(bundle_version_id, resource_id)
        except BundleError:
            raise
        except Exception as exc:
            raise BundleError(
                BUNDLE_RESOURCE_UNKNOWN, f"无法装载 always_on 资源: {resource_id}"
            ) from exc
        content = body.get("content") if isinstance(body, Mapping) else None
        if not isinstance(content, str):
            raise BundleError(
                BUNDLE_RESOURCE_UNKNOWN, f"always_on 资源缺少正文: {resource_id}"
            )
        return content

    @staticmethod
    def _render_instructions(
        role_body: str,
        rule_bodies: list[str],
        skills: list[Mapping[str, Any]],
    ) -> str:
        parts = [role_body]
        if rule_bodies:
            parts.append("## Always-on Rules")
            parts.extend(rule_bodies)
        if skills:
            parts.append("## Available Skills")
            for skill in skills:
                metadata = _skill_metadata(skill)
                parts.append(
                    f"- name: {metadata.get('name', '')} | "
                    f"description: {metadata.get('description', '')} | "
                    f"allowImplicitInvocation: {metadata.get('allowImplicitInvocation')}"
                )
        return "\n\n".join(parts)

    @staticmethod
    def _enforce_initial_budget(
        composition: Mapping[str, Any],
        role_body: str,
        rule_bodies: list[str],
        skills: list[Mapping[str, Any]],
    ) -> None:
        budget = composition.get("tokenBudget")
        max_initial = (
            budget.get("initialContextMaxTokens") if isinstance(budget, Mapping) else None
        )
        if not isinstance(max_initial, int):
            raise BundleError(
                BUNDLE_SNAPSHOT_MALFORMED, "tokenBudget 缺少 initialContextMaxTokens"
            )
        total = _estimate_chars_div_4(role_body)
        total += sum(_estimate_chars_div_4(body) for body in rule_bodies)
        for skill in skills:
            metadata = _skill_metadata(skill)
            total += _estimate_chars_div_4(
                f"{metadata.get('name', '')}\n{metadata.get('description', '')}"
            )
        if total > max_initial:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                "初始上下文（RoleDocument + always_on Rules + Skill 元数据）超预算",
            )
