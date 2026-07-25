"""Bundle 发布快照与资源拉取端口（契约 §6 / IK2QBI + IK2QBJ）。

``BundleSource`` 抽象 Java 内部 API 的快照与单资源拉取，使校验器与装载器可在内存 Fake
下测全部行为（IK2QBI / IK2QBJ Testing Decisions 接缝一）。HTTP 实现见 ``JavaRunGateway``。

- ``fetch_snapshot``：整份发布快照（camelCase），含 manifest 摘要但不含资源正文。
- ``fetch_resource``：单资源正文（snake_case metadata + content）。IK2QBJ 用它装载
  always_on 基础上下文（RoleDocument + 常驻 Rule 正文）；IK2QBM 复用同一方法做
  on_demand 受限解析与缓存。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol


class BundleSource(Protocol):
    def fetch_snapshot(self, bundle_version_id: str) -> Mapping[str, Any]:
        """按 ``bundleVersionId`` 拉取整份发布快照（camelCase，无正文）。缺失抛异常。"""

    def fetch_resource(
        self, bundle_version_id: str, resource_id: str
    ) -> Mapping[str, Any]:
        """按 ``resourceId`` 拉取单资源正文（snake_case metadata + content）。缺失抛异常。"""


class FakeBundleSource:
    """内存版 ``BundleSource``：模拟 Java 快照与资源响应，记录拉取次数（测试用）。"""

    def __init__(
        self,
        snapshots: Mapping[str, Mapping[str, Any]] | None = None,
        resources: Mapping[str, Mapping[str, Mapping[str, Any]]] | None = None,
    ) -> None:
        self._snapshots: dict[str, Mapping[str, Any]] = dict(snapshots or {})
        self._resources: dict[str, dict[str, Mapping[str, Any]]] = {
            bundle_id: dict(items) for bundle_id, items in (resources or {}).items()
        }
        self.snapshot_fetches = 0
        self.resource_fetches = 0

    def fetch_snapshot(self, bundle_version_id: str) -> Mapping[str, Any]:
        self.snapshot_fetches += 1
        snapshot = self._snapshots.get(bundle_version_id)
        if snapshot is None:
            raise KeyError(bundle_version_id)
        return dict(snapshot)

    def fetch_resource(
        self, bundle_version_id: str, resource_id: str
    ) -> Mapping[str, Any]:
        self.resource_fetches += 1
        bundle = self._resources.get(bundle_version_id)
        if bundle is None:
            raise KeyError(bundle_version_id)
        resource = bundle.get(resource_id)
        if resource is None:
            raise KeyError(resource_id)
        return dict(resource)
