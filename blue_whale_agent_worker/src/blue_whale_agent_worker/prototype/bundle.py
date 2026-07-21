"""最小 Runtime Agent Bundle 快照与资源闸门（原型）。

验证问题：契约 §4.2/§6 的渐进装载、摘要校验与 token 预算闸门，
能否在 Worker 侧以少量代码可靠实现并支撑 fail closed 语义。

依据：docs/specs/2026-07-20-runtime-agent-bundle-contract.md（Accepted v1）。
简化：manifestDigest 用排序元组 SHA-256 代替 RFC 8785 JCS；token 估算用
estimate_tokens 占位算法，生产必须换成契约要求的平台统一估算器。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

LOAD_ALWAYS_ON = "always_on"

KIND_ROLE_DOCUMENT = "role_document"
KIND_RULE = "rule"
KIND_RUNTIME_SKILL = "runtime_skill"

# 规范化错误码（契约 §4.2/§6：fail closed，不静默截断、不回退默认提示词）
BUNDLE_VERSION_PIN_MISMATCH = "BUNDLE_VERSION_PIN_MISMATCH"
BUNDLE_MANIFEST_DIGEST_MISMATCH = "BUNDLE_MANIFEST_DIGEST_MISMATCH"
BUNDLE_RESOURCE_UNKNOWN = "BUNDLE_RESOURCE_UNKNOWN"
BUNDLE_RESOURCE_DIGEST_MISMATCH = "BUNDLE_RESOURCE_DIGEST_MISMATCH"
BUNDLE_TOKEN_BUDGET_EXCEEDED = "BUNDLE_TOKEN_BUDGET_EXCEEDED"
MODEL_CAPABILITY_INSUFFICIENT = "MODEL_CAPABILITY_INSUFFICIENT"
PROTOCOL_MIXED_STREAM = "PROTOCOL_MIXED_STREAM"
PROTOCOL_PENDING_CALL_MISMATCH = "PROTOCOL_PENDING_CALL_MISMATCH"
STREAM_IDEMPOTENCY_CONFLICT = "STREAM_IDEMPOTENCY_CONFLICT"


class BundleError(Exception):
    """规范化原型错误：code 面向 Java / 审计，message 不携带敏感原文。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


@dataclass(frozen=True)
class TokenBudget:
    initial_context_max_tokens: int
    single_resource_max_tokens: int
    active_context_max_tokens: int


@dataclass(frozen=True)
class BundleResource:
    resource_id: str
    revision: int
    kind: str
    path: str
    load_mode: str
    content: str
    content_digest: str  # manifest 固化的摘要；闸门按实际字节重算比对
    token_estimate: int
    description: str = ""
    references: tuple[str, ...] = ()  # 已固化 resolvedResourceId（契约 §3.2）


@dataclass(frozen=True)
class ModelProfileSpec:
    model_key: str
    capabilities: frozenset[str]  # text / tool_calling / vision / structured_output


@dataclass(frozen=True)
class BundleSnapshot:
    bundle_version_id: str
    version: str
    resources: tuple[BundleResource, ...]
    budget: TokenBudget
    model_profile: ModelProfileSpec
    manifest_digest: str


def build_snapshot(
    bundle_version_id: str,
    version: str,
    resources: list[tuple[str, str, str, str, str, str, tuple[str, ...]]],
    budget: TokenBudget,
    model_profile: ModelProfileSpec,
) -> BundleSnapshot:
    """原型快照构建器：按内容计算摘要，替代真实发布器。

    resources 条目：(resource_id, kind, path, load_mode, content, description, references)。
    """
    built: list[BundleResource] = []
    for i, (rid, kind, path, load_mode, content, description, references) in enumerate(
        resources, start=1
    ):
        built.append(
            BundleResource(
                resource_id=rid,
                revision=i,
                kind=kind,
                path=path,
                load_mode=load_mode,
                content=content,
                content_digest=sha256_text(content),
                token_estimate=estimate_tokens(content),
                description=description,
                references=references,
            )
        )
    digest_src = "\n".join(
        f"{r.resource_id}:{r.revision}:{r.content_digest}"
        for r in sorted(built, key=lambda r: r.resource_id)
    )
    return BundleSnapshot(
        bundle_version_id=bundle_version_id,
        version=version,
        resources=tuple(built),
        budget=budget,
        model_profile=model_profile,
        manifest_digest=sha256_text(digest_src),
    )


@dataclass(frozen=True)
class ReadEvidence:
    resource_id: str
    revision: int
    content_digest: str
    token_estimate: int
    origin: str  # initial / on_demand / history


class ResourceGate:
    """单个 AgentRun 的资源读取闸门。

    认领 Run 时校验版本 pin 与 manifestDigest 并装载初始上下文；
    之后只按已固化 resourceId 读取，读前校验摘要与预算，全程记账。
    """

    def __init__(
        self,
        snapshot: BundleSnapshot,
        pinned_bundle_version_id: str,
        expected_manifest_digest: str,
    ) -> None:
        if pinned_bundle_version_id != snapshot.bundle_version_id:
            raise BundleError(
                BUNDLE_VERSION_PIN_MISMATCH,
                "AgentRun 固定的 Bundle 版本与 Worker 快照不一致",
            )
        if expected_manifest_digest != snapshot.manifest_digest:
            raise BundleError(
                BUNDLE_MANIFEST_DIGEST_MISMATCH,
                "发布快照摘要与 AgentRun 固定摘要不符",
            )
        self._snapshot = snapshot
        self._by_id = {r.resource_id: r for r in snapshot.resources}
        self._loaded: dict[str, BundleResource] = {}
        self._ledger: list[ReadEvidence] = []
        self._active_tokens = 0
        self._load_initial_context()

    def _load_initial_context(self) -> None:
        initial = [
            r
            for r in self._snapshot.resources
            if r.load_mode == LOAD_ALWAYS_ON
        ]
        skill_metadata_tokens = sum(
            estimate_tokens(f"{r.resource_id} {r.description}")
            for r in self._snapshot.resources
            if r.kind == KIND_RUNTIME_SKILL
        )
        initial_tokens = sum(r.token_estimate for r in initial) + skill_metadata_tokens
        if initial_tokens > self._snapshot.budget.initial_context_max_tokens:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                "初始上下文（RoleDocument + always_on Rules + Skill 元数据）超预算",
            )
        for resource in initial:
            self._loaded[resource.resource_id] = resource
            self._active_tokens += resource.token_estimate
            self._ledger.append(
                ReadEvidence(
                    resource_id=resource.resource_id,
                    revision=resource.revision,
                    content_digest=resource.content_digest,
                    token_estimate=resource.token_estimate,
                    origin="initial",
                )
            )

    def read(self, resource_id: str) -> BundleResource:
        resource = self._by_id.get(resource_id)
        if resource is None:
            raise BundleError(
                BUNDLE_RESOURCE_UNKNOWN, f"资源未在发布快照中登记: {resource_id}"
            )
        if sha256_text(resource.content) != resource.content_digest:
            raise BundleError(
                BUNDLE_RESOURCE_DIGEST_MISMATCH,
                f"资源字节与 manifest 摘要不符: {resource_id}",
            )
        if resource_id in self._loaded:
            return resource
        if resource.token_estimate > self._snapshot.budget.single_resource_max_tokens:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                f"单资源超预算: {resource_id}",
            )
        if (
            self._active_tokens + resource.token_estimate
            > self._snapshot.budget.active_context_max_tokens
        ):
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                f"活动上下文超预算: {resource_id}",
            )
        self._loaded[resource_id] = resource
        self._active_tokens += resource.token_estimate
        self._ledger.append(
            ReadEvidence(
                resource_id=resource.resource_id,
                revision=resource.revision,
                content_digest=resource.content_digest,
                token_estimate=resource.token_estimate,
                origin="on_demand",
            )
        )
        return resource

    def register_from_history(self, resource_id: str) -> None:
        """恢复 Run 时按 checkpoint 消息历史回填账本（同一 Run 的已读证据）。

        历史中的资源字节已经随消息进入模型上下文，因此仍计入活动预算；
        超预算同样 fail closed，不因是恢复而放宽。
        """
        resource = self._by_id.get(resource_id)
        if resource is None or resource_id in self._loaded:
            return
        if (
            self._active_tokens + resource.token_estimate
            > self._snapshot.budget.active_context_max_tokens
        ):
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                f"恢复已读资源后活动上下文超预算: {resource_id}",
            )
        self._loaded[resource_id] = resource
        self._active_tokens += resource.token_estimate
        self._ledger.append(
            ReadEvidence(
                resource_id=resource.resource_id,
                revision=resource.revision,
                content_digest=resource.content_digest,
                token_estimate=resource.token_estimate,
                origin="history",
            )
        )

    def initial_instructions(self) -> str:
        s = self._snapshot
        parts = [
            f"[RuntimeAgentBundle {s.bundle_version_id} v{s.version} {s.manifest_digest[:23]}]",
        ]
        for r in s.resources:
            if r.kind == KIND_ROLE_DOCUMENT:
                parts.append(r.content)
        always_rules = [
            r
            for r in s.resources
            if r.kind == KIND_RULE and r.load_mode == LOAD_ALWAYS_ON
        ]
        if always_rules:
            parts.append("## Always-on Rules")
            parts.extend(r.content for r in always_rules)
        skills = [r for r in s.resources if r.kind == KIND_RUNTIME_SKILL]
        if skills:
            parts.append(
                "## Available Skills（元数据；用 read_resource 按 resource_id 读取正文）"
            )
            parts.extend(f"- {r.resource_id}: {r.description}" for r in skills)
        return "\n\n".join(parts)

    def evidence(self) -> dict[str, object]:
        return {
            "bundle_version_id": self._snapshot.bundle_version_id,
            "manifest_digest": self._snapshot.manifest_digest,
            "model_key": self._snapshot.model_profile.model_key,
            "resources_read": [
                {
                    "resource_id": e.resource_id,
                    "revision": e.revision,
                    "content_digest": e.content_digest,
                    "origin": e.origin,
                }
                for e in self._ledger
            ],
        }
