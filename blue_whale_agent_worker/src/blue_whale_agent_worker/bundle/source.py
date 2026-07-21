"""Bundle 发布快照拉取端口（契约 §6 / IK2QBI）。

``BundleSource`` 抽象 Java 内部 API 的快照拉取，使校验器可在内存 Fake 下测全部
校验行为（IK2QBI Testing Decisions 接缝一）。HTTP 实现见 ``JavaRunGateway``。
按需单资源拉取（GET .../resources/{resourceId}）与受限资源解析由 sibling IK2QBM 承接。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol


class BundleSource(Protocol):
    def fetch_snapshot(self, bundle_version_id: str) -> Mapping[str, Any]:
        """按 ``bundleVersionId`` 拉取整份发布快照（camelCase）。快照缺失时抛异常。"""


class FakeBundleSource:
    """内存版 ``BundleSource``：模拟 Java 快照响应，记录拉取次数（测试用）。"""

    def __init__(
        self, snapshots: Mapping[str, Mapping[str, Any]] | None = None
    ) -> None:
        self._snapshots: dict[str, Mapping[str, Any]] = dict(snapshots or {})
        self.snapshot_fetches = 0

    def fetch_snapshot(self, bundle_version_id: str) -> Mapping[str, Any]:
        self.snapshot_fetches += 1
        snapshot = self._snapshots.get(bundle_version_id)
        if snapshot is None:
            raise KeyError(bundle_version_id)
        return dict(snapshot)
