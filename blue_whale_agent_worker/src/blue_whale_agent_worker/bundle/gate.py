"""受限资源读取闸门（契约 §6 / IK2QBM）。

硬化自原型 ``ResourceGate``（IK2D8I）的读取语义进正式 bundle 子包。模型只能经此闸门
按 manifest 已固化的 resolvedResourceId 读取 on_demand 资源正文；运行时不做路径解析、
模糊查找、网络或跨 Bundle 寻址。首次 on_demand 读取与 checkpoint 恢复重建走完全同一
``_charge`` 路径，按序：

1. ``resource_id`` 必须在 manifest 已登记（未知 → ``BUNDLE_RESOURCE_UNKNOWN``）
2. 拉取正文后重算 ``sha256:<hex>`` 与 manifest 固化的 ``contentDigest`` 比对
   （篡改 → ``BUNDLE_RESOURCE_DIGEST_MISMATCH``）
3. 过 ``singleResourceMaxTokens`` 门（超限 → ``BUNDLE_TOKEN_BUDGET_EXCEEDED``，不截断）
4. 过 ``activeContextMaxTokens`` 累计门（含初始上下文基线，超限 →
   ``BUNDLE_TOKEN_BUDGET_EXCEEDED``，不截断）
5. 记录 ``ReadEvidence``（``origin=on_demand`` 或 ``history``）

checkpoint 恢复时从消息历史中的 ``read_resource`` 调用确定性重建已读集合
（``register_from_history``，``origin=history``）：重建与首次读取同样 fetch 正文、重算
digest、用 ``chars_div_4`` 重算 token、过双预算门——不读 manifest 自报 ``tokenEstimate``，
使恢复路径与首次读取预算累计口径逐字节一致，不构成侧门。

token 估算复用 ``ContextLoader`` 的 ``chars_div_4`` 算法（与 Java 发布侧
``RuntimeBundleValidator.estimateTokens`` 逐字节一致）。错误消息不含快照正文或私有路径。
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .errors import (
    BUNDLE_RESOURCE_DIGEST_MISMATCH,
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_SNAPSHOT_MALFORMED,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    BundleError,
)
from .source import BundleSource
from .tokens import estimate_chars_div_4
from .verifier import VerifiedSnapshot, composition_mapping, resource_manifest

ORIGIN_INITIAL = "initial"
ORIGIN_ON_DEMAND = "on_demand"
ORIGIN_HISTORY = "history"
ORIGIN_CONVERSATION = "conversation"


def _sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ReadEvidence:
    """单次资源读取证据：随 commit 回传 Java，与 usage 指标同通道（契约 §6 第 4 条）。"""

    resource_id: str
    revision: int
    content_digest: str
    token_estimate: int
    origin: str  # initial / on_demand / history


class ResourceGate:
    """单个 AgentRun 的受限资源读取闸门。"""

    def __init__(
        self,
        verified: VerifiedSnapshot,
        source: BundleSource,
        *,
        initial_tokens: int = 0,
        initial_evidence: tuple[ReadEvidence, ...] = (),
    ) -> None:
        self._verified = verified
        self._source = source
        manifest = resource_manifest(verified.snapshot)  # 复用 verifier 的 manifest 访问
        if manifest is None:
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "发布快照缺少 resourceManifest")
        budget = composition_mapping(verified.snapshot, "tokenBudget")
        if budget is None:
            raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, "发布快照缺少 tokenBudget")
        self._by_id = _index_resources(manifest)
        self._single_max = _require_int(
            budget, "singleResourceMaxTokens", "tokenBudget 缺少 singleResourceMaxTokens"
        )
        self._active_max = _require_int(
            budget, "activeContextMaxTokens", "tokenBudget 缺少 activeContextMaxTokens"
        )
        # 已验证正文缓存（同 Run 内同资源只拉取一次）与已计 token 资源集合。
        self._cache: dict[str, str] = {}
        self._charged: set[str] = set()
        self._ledger: list[ReadEvidence] = list(initial_evidence)
        self._active_tokens = initial_tokens
        for evidence in initial_evidence:
            self._charged.add(evidence.resource_id)

    @property
    def active_tokens(self) -> int:
        return self._active_tokens

    def read(self, resource_id: str) -> str:
        resource = self._by_id.get(resource_id)
        if resource is None:
            raise BundleError(
                BUNDLE_RESOURCE_UNKNOWN, f"资源未在发布快照中登记: {resource_id}"
            )
        if resource_id in self._charged:
            # 初始装载或已读过：不重复计 token，幂等返回正文（仍经 digest 校验）
            return self._fetch_and_verify(resource_id, resource)
        return self._charge(resource_id, resource, ORIGIN_ON_DEMAND)

    def register_from_history(self, resource_id: str) -> None:
        """恢复 Run 时按 checkpoint 消息历史回填账本（同一 Run 的已读证据）。

        与首次读取走完全同一 ``_charge`` 路径：fetch 正文、重算 digest、用 ``chars_div_4``
        重算 token、过 single / active 双预算门。历史中的资源字节已经随消息进入模型上下文，
        因此仍计入活动预算；超限同样 fail closed，不因是恢复而放宽、不读 manifest 自报
        tokenEstimate，避免恢复路径与首次读取预算累计口径漂移。
        """
        resource = self._by_id.get(resource_id)
        if resource is None or resource_id in self._charged:
            return
        self._charge(resource_id, resource, ORIGIN_HISTORY)

    def charge_conversation(self, resource_id: str, content: str) -> None:
        """非 manifest 内容（对话读取，IK2QBZ）的记账：无 digest 比对，同一双预算门与账本。

        Conversation 消息非 Bundle 资源，无固化 ``contentDigest`` 可比对；token 估算、
        single / active 双预算门与 ReadEvidence 记账和 manifest 资源完全同口径，计入
        同一活动上下文累计（``origin=conversation``，``revision`` 恒 0，digest 为本次
        返回内容的 sha256）。每次调用独立记账——翻页读取各计各的，不走 ``_charged``
        幂等去重（对话内容随游标变化，非不可变 Bundle 字节）。
        """
        tokens = estimate_chars_div_4(content)
        if tokens > self._single_max:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED, "单次对话读取超预算，已拒绝而非截断"
            )
        if self._active_tokens + tokens > self._active_max:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED, "活动上下文超预算，已拒绝而非截断"
            )
        self._active_tokens += tokens
        self._ledger.append(
            ReadEvidence(
                resource_id=resource_id,
                revision=0,
                content_digest=_sha256_text(content),
                token_estimate=tokens,
                origin=ORIGIN_CONVERSATION,
            )
        )

    def evidence(self) -> tuple[ReadEvidence, ...]:
        return tuple(self._ledger)

    def _charge(
        self, resource_id: str, resource: Mapping[str, Any], origin: str
    ) -> str:
        """首次读取 / 恢复重建的共享记账路径：fetch + digest 校验 + 双预算门 + 证据。"""
        content = self._fetch_and_verify(resource_id, resource)
        tokens = estimate_chars_div_4(content)
        if tokens > self._single_max:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED, "单资源超预算，已拒绝而非截断"
            )
        if self._active_tokens + tokens > self._active_max:
            raise BundleError(
                BUNDLE_TOKEN_BUDGET_EXCEEDED,
                "恢复已读资源后活动上下文超预算"
                if origin == ORIGIN_HISTORY
                else "活动上下文超预算，已拒绝而非截断",
            )
        self._active_tokens += tokens
        self._charged.add(resource_id)
        self._ledger.append(
            ReadEvidence(
                resource_id=resource_id,
                revision=revision(resource),
                content_digest=content_digest(resource),
                token_estimate=tokens,
                origin=origin,
            )
        )
        return content

    def _fetch_and_verify(self, resource_id: str, resource: Mapping[str, Any]) -> str:
        """拉取并校验资源正文：重算 sha256 比对 manifest contentDigest，首次校验后缓存。

        同一 Run 内资源字节不可变，故重复读取命中缓存直接返回、不再 fetch 也不重算 digest
        ——与 Brief「每次读取重算」安全等价（首次已校验，缓存即校验通过的不可变字节）。
        """
        cached = self._cache.get(resource_id)
        if cached is not None:
            return cached
        try:
            body = self._source.fetch_resource(
                self._verified.bundle_version_id, resource_id
            )
        except BundleError:
            raise
        except Exception as exc:  # 源端任何异常都 fail closed，绝不回退
            raise BundleError(BUNDLE_RESOURCE_UNKNOWN, "无法读取按需资源") from exc
        content = body.get("content") if isinstance(body, Mapping) else None
        if not isinstance(content, str):
            raise BundleError(BUNDLE_RESOURCE_UNKNOWN, "按需资源缺少正文")
        if _sha256_text(content) != content_digest(resource):
            raise BundleError(
                BUNDLE_RESOURCE_DIGEST_MISMATCH, "按需资源字节与 manifest 摘要不符"
            )
        self._cache[resource_id] = content
        return content


def _index_resources(manifest: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    resources = manifest.get("resources")
    index: dict[str, Mapping[str, Any]] = {}
    if isinstance(resources, list):
        for resource in resources:
            if isinstance(resource, Mapping):
                resource_id = resource.get("resourceId")
                if isinstance(resource_id, str):
                    index[resource_id] = resource
    return index


def _require_int(mapping: Mapping[str, Any], key: str, message: str) -> int:
    value = mapping.get(key)
    if not isinstance(value, int):
        raise BundleError(BUNDLE_SNAPSHOT_MALFORMED, message)
    return value


def resource_id(resource: Mapping[str, Any]) -> str:
    value = resource.get("resourceId")
    return value if isinstance(value, str) else ""


def revision(resource: Mapping[str, Any]) -> int:
    value = resource.get("revision")
    return value if isinstance(value, int) else 0


def content_digest(resource: Mapping[str, Any]) -> str:
    value = resource.get("contentDigest")
    return value if isinstance(value, str) else ""
