"""Bundle 发布快照校验器（契约 §6 / IK2QBI）。

按 AgentRun pin 拉取发布快照，本地用 canonical JSON 重算 manifestDigest 并与 Run pin
逐字节比对：

- ``bundleVersionId`` 与 Run pin 不一致，或快照缺失 / 源端异常
  → ``BUNDLE_VERSION_PIN_MISMATCH``
- 本地重算的 manifestDigest 与快照自带值不一致（正文被篡改），或与 Run pin 不一致
  （版本漂移 / Java 配置错误）→ ``BUNDLE_MANIFEST_DIGEST_MISMATCH``

任何错误都不进入模型调用，绝不回退默认提示词或 Mock；错误消息为固定文案，不含
快照正文或私有路径。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .canonical import manifest_digest
from .errors import (
    BUNDLE_MANIFEST_DIGEST_MISMATCH,
    BUNDLE_VERSION_PIN_MISMATCH,
    BundleError,
)
from .source import BundleSource


@dataclass(frozen=True)
class VerifiedSnapshot:
    """校验通过的发布快照引用：固定身份 + 原始 camelCase 快照（透传给后续装载）。"""

    bundle_version_id: str
    manifest_digest: str
    snapshot: Mapping[str, Any]


def _resource_manifest(snapshot: Mapping[str, Any]) -> Mapping[str, Any] | None:
    composition = snapshot.get("composition")
    if not isinstance(composition, Mapping):
        return None
    manifest = composition.get("resourceManifest")
    return manifest if isinstance(manifest, Mapping) else None


class BundleVerifier:
    """按 AgentRun 固定的 pin 校验发布快照。"""

    def __init__(self, source: BundleSource) -> None:
        self._source = source

    def verify(
        self,
        pinned_bundle_version_id: str,
        expected_manifest_digest: str,
    ) -> VerifiedSnapshot:
        try:
            snapshot = self._source.fetch_snapshot(pinned_bundle_version_id)
        except BundleError:
            raise
        except Exception as exc:  # 源端任何异常都 fail closed，绝不回退
            raise BundleError(
                BUNDLE_VERSION_PIN_MISMATCH, "无法获取 Bundle 发布快照"
            ) from exc

        if not isinstance(snapshot, Mapping) or not snapshot:
            raise BundleError(BUNDLE_VERSION_PIN_MISMATCH, "Bundle 发布快照缺失")

        actual_bundle_version_id = snapshot.get("bundleVersionId")
        if actual_bundle_version_id != pinned_bundle_version_id:
            raise BundleError(
                BUNDLE_VERSION_PIN_MISMATCH,
                "快照 bundleVersionId 与 AgentRun pin 不一致",
            )

        manifest = _resource_manifest(snapshot)
        if manifest is None:
            raise BundleError(
                BUNDLE_MANIFEST_DIGEST_MISMATCH, "发布快照缺少 resourceManifest"
            )
        declared_digest = manifest.get("manifestDigest")
        if not isinstance(declared_digest, str) or not declared_digest:
            raise BundleError(
                BUNDLE_MANIFEST_DIGEST_MISMATCH,
                "resourceManifest 缺少 manifestDigest",
            )

        recomputed = manifest_digest(dict(manifest))
        if recomputed != declared_digest:
            # 快照正文被篡改：自带的 manifestDigest 与本地重算不一致
            raise BundleError(
                BUNDLE_MANIFEST_DIGEST_MISMATCH,
                "本地重算 manifestDigest 与快照自带值不一致",
            )
        if declared_digest != expected_manifest_digest:
            # Run pin 与快照漂移（Java 配置错误或版本错位）
            raise BundleError(
                BUNDLE_MANIFEST_DIGEST_MISMATCH,
                "发布快照 manifestDigest 与 AgentRun pin 不一致",
            )

        return VerifiedSnapshot(
            bundle_version_id=actual_bundle_version_id,
            manifest_digest=declared_digest,
            snapshot=snapshot,
        )
