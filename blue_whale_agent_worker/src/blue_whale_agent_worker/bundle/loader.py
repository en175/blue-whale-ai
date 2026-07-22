"""Runtime Agent Bundle 基础上下文装载器（契约 §6 / IK2QBJ + IK2QBM）。

消费 ``BundleVerifier`` 校验通过的 ``VerifiedSnapshot``，按 always_on 装载基础上下文
（RoleDocument + always_on Rules 正文 + 全部 RuntimeSkill 元数据），拼成 Agent 初始
instructions，并过 ``initialContextMaxTokens`` 预算门。Skill 正文不进入初始上下文
（按需 ``read_resource`` 由 sibling IK2QBM 承接）。

IK2QBM：``load`` 同时产出活动上下文基线 token 与 always_on 资源的 ``ReadEvidence``
（``origin=initial``），交给 ``ResourceGate`` 作为 on_demand 预算累计与账本起点。active
基线含 Skill 元数据（已进入 instructions），evidence 只记实际资源读取。

token 估算按快照 ``TokenBudget.estimator`` 执行（当前仅 ``chars_div_4``），与 Java 发布侧
``RuntimeBundleValidator.estimateTokens`` 逐字节一致：空串 0，否则 ``max(1, (len + 3) // 4)``；
Skill 元数据估算对象为 ``name + "\\n" + description``（对齐 Java 预算校验）；Skill 已解析引用的
``resolvedResourceId`` 进入初始上下文（模型逐层 ``read_resource`` 的寻址键），额外计入活动基线。
根 ``RuntimeSkill`` 自身的 ``resourceId``（来自 ``composition.rootRuntimeSkillId``）同样进入初始
上下文，作为模型按需 ``read_resource`` 读取根 Skill 正文的寻址键，额外计入活动基线。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .errors import (
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_SNAPSHOT_MALFORMED,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    MODEL_CAPABILITY_INSUFFICIENT,
    BundleError,
)
from .gate import (
    ORIGIN_INITIAL,
    ReadEvidence,
    content_digest,
    resource_id,
    revision,
)
from .source import BundleSource
from .tokens import estimate_chars_div_4
from .verifier import VerifiedSnapshot

LOAD_ALWAYS_ON = "always_on"
KIND_ROLE_DOCUMENT = "role_document"
KIND_RULE = "rule"
KIND_RUNTIME_SKILL = "runtime_skill"

# 契约 §2.4：运行 Agent 需要 tool_calling 才能提议受限工具动作。
REQUIRED_CAPABILITIES = frozenset({"tool_calling"})
SUPPORTED_TOKEN_ESTIMATOR = "chars_div_4"


@dataclass(frozen=True)
class LoadedContext:
    """基础上下文装载产物：instructions + 活动基线 token + initial 读取证据。

    ``initial_tokens`` 含 Skill 元数据（已进入 instructions），是 ``activeContextMaxTokens``
    累计门的起点；``initial_evidence`` 只记 always_on 资源的实际读取（Skill 元数据经
    instructions 体现，非独立资源读取）。
    """

    instructions: str
    initial_tokens: int
    initial_evidence: tuple[ReadEvidence, ...]


def _skill_metadata(skill: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = skill.get("metadata")
    return metadata if isinstance(metadata, Mapping) else {}


def _skill_reference_ids(skill: Mapping[str, Any]) -> tuple[str, ...]:
    """Skill 已解析引用的 resourceId：模型逐层 read_resource 的寻址键（契约 §6 第 3 条）。"""
    references = skill.get("references")
    if not isinstance(references, list):
        return ()
    identifiers: list[str] = []
    for reference in references:
        if isinstance(reference, Mapping):
            resolved = reference.get("resolvedResourceId")
            if isinstance(resolved, str) and resolved:
                identifiers.append(resolved)
    return tuple(identifiers)


class ContextLoader:
    """按 Run pin 的 BundleVersion 装载基础上下文，产出 Agent 初始 instructions。"""

    def __init__(self, source: BundleSource) -> None:
        self._source = source

    def load(
        self,
        verified: VerifiedSnapshot,
        model_profile_id: str,
        model_profile_version: str,
    ) -> LoadedContext:
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
        root_runtime_skill_id = composition.get("rootRuntimeSkillId")
        instructions = self._render_instructions(
            role_body, rule_bodies, skills, root_runtime_skill_id
        )

        initial_tokens = self._initial_token_total(
            composition, role_body, rule_bodies, skills
        )
        initial_evidence = self._initial_evidence(
            role, role_body, always_rules, rule_bodies
        )
        return LoadedContext(instructions, initial_tokens, initial_evidence)

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
        root_runtime_skill_id: str | None,
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
                # 披露根 RuntimeSkill 自身 resourceId：模型据此 read_resource 读根 Skill 正文
                if root_runtime_skill_id:
                    parts.append(f"  - skill resourceId: {root_runtime_skill_id}")
                # 披露已解析引用的 resourceId：模型据此逐层 read_resource 读 Rule/Workflow/Reference
                for ref_id in _skill_reference_ids(skill):
                    parts.append(f"  - reference resourceId: {ref_id}")
        return "\n\n".join(parts)

    @staticmethod
    def _initial_token_total(
        composition: Mapping[str, Any],
        role_body: str,
        rule_bodies: list[str],
        skills: list[Mapping[str, Any]],
    ) -> int:
        budget = composition.get("tokenBudget")
        max_initial = (
            budget.get("initialContextMaxTokens") if isinstance(budget, Mapping) else None
        )
        if not isinstance(max_initial, int):
            raise BundleError(
                BUNDLE_SNAPSHOT_MALFORMED, "tokenBudget 缺少 initialContextMaxTokens"
            )
        total = estimate_chars_div_4(role_body)
        total += sum(estimate_chars_div_4(body) for body in rule_bodies)
        for skill in skills:
            metadata = _skill_metadata(skill)
            total += estimate_chars_div_4(
                f"{metadata.get('name', '')}\n{metadata.get('description', '')}"
            )
            # 引用 resourceId 进入初始上下文（模型逐层读取的寻址键），计入活动基线
            for ref_id in _skill_reference_ids(skill):
                total += estimate_chars_div_4(ref_id)
        # 根 RuntimeSkill 自身 resourceId 进入初始上下文（根 Skill 正文寻址键），计入活动基线
        root_runtime_skill_id = composition.get("rootRuntimeSkillId")
        if isinstance(root_runtime_skill_id, str) and root_runtime_skill_id:
            total += estimate_chars_div_4(root_runtime_skill_id)
        if total > max_initial:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                "初始上下文（RoleDocument + always_on Rules + Skill 元数据）超预算",
            )
        return total

    @staticmethod
    def _initial_evidence(
        role: Mapping[str, Any],
        role_body: str,
        always_rules: list[Mapping[str, Any]],
        rule_bodies: list[str],
    ) -> tuple[ReadEvidence, ...]:
        evidence: list[ReadEvidence] = [
            ReadEvidence(
                resource_id=resource_id(role),
                revision=revision(role),
                content_digest=content_digest(role),
                token_estimate=estimate_chars_div_4(role_body),
                origin=ORIGIN_INITIAL,
            )
        ]
        for rule, body in zip(always_rules, rule_bodies, strict=True):
            evidence.append(
                ReadEvidence(
                    resource_id=resource_id(rule),
                    revision=revision(rule),
                    content_digest=content_digest(rule),
                    token_estimate=estimate_chars_div_4(body),
                    origin=ORIGIN_INITIAL,
                )
            )
        return tuple(evidence)
