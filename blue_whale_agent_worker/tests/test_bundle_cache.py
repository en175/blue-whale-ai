"""内容寻址资源缓存装饰层测试（工单 IK2QBP）。

接缝：内存 ``FakeBundleSource``（记录 ``resource_fetches`` 计数）作为内层，
``CachingBundleSource`` 装饰它，用 ``TemporaryDirectory`` 注入磁盘缓存根。覆盖：

- 同内容同版本二次读取零网络（计数 Fake 断言）
- Worker 进程重启（新实例 + 新 inner + 同 cache_dir）后命中磁盘，零网络
- 新 BundleVersion 命名空间隔离，不误用旧版本缓存
- 磁盘正文被篡改时丢弃回源，绝不用脏数据（fail closed 由上层 ResourceGate 收口）
- 索引损坏 / 丢失时静默回源重建，不抛错
- fetch_resource 返回 body 形状经缓存往返保持一致
- 缓存大小有界，超限按版本目录淘汰，不无限增长
- fetch_snapshot 透传不缓存（manifestDigest 校验是安全锚点）
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from blue_whale_agent_worker.bundle.cache import CachingBundleSource
from blue_whale_agent_worker.bundle.gate import ResourceGate
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from test_bundle_gate import (
    REF_BODY,
    _initial_baseline_tokens,
    _initial_evidence,
    _make_snapshot,
    _source,
    _verified,
)

_BODY_A = "正文内容A"
_BODY_B = "正文内容B长一些以拉开sha256"


def _single_source():
    return FakeBundleSource(
        snapshots={"bv1": {"bundleVersionId": "bv1"}},
        resources={"bv1": {"r1": {"resource_id": "r1", "content": _BODY_A, "meta": 1}}},
    )


class CachingBundleSourceHitTest(unittest.TestCase):
    def test_second_fetch_hits_cache_zero_network(self) -> None:
        with TemporaryDirectory() as tmp:
            inner = _single_source()
            cache = CachingBundleSource(inner, Path(tmp))

            first = cache.fetch_resource("bv1", "r1")
            second = cache.fetch_resource("bv1", "r1")

            self.assertEqual(_BODY_A, first["content"])
            self.assertEqual(first, second)
            self.assertEqual(1, inner.resource_fetches)  # 二次零网络

    def test_cache_survives_new_instance_simulating_restart(self) -> None:
        # Worker 进程重启：新 CachingBundleSource + 全新 inner + 同 cache_dir → 命中磁盘
        with TemporaryDirectory() as tmp:
            CachingBundleSource(_single_source(), Path(tmp)).fetch_resource("bv1", "r1")

            fresh_inner = _single_source()
            body = CachingBundleSource(fresh_inner, Path(tmp)).fetch_resource("bv1", "r1")

            self.assertEqual(_BODY_A, body["content"])
            self.assertEqual(0, fresh_inner.resource_fetches)  # 命中磁盘，零网络

    def test_version_isolation_does_not_cross_use(self) -> None:
        with TemporaryDirectory() as tmp:
            inner = FakeBundleSource(
                snapshots={
                    "bv1": {"bundleVersionId": "bv1"},
                    "bv2": {"bundleVersionId": "bv2"},
                },
                resources={
                    "bv1": {"r1": {"resource_id": "r1", "content": "v1"}},
                    "bv2": {"r1": {"resource_id": "r1", "content": "v2"}},
                },
            )
            cache = CachingBundleSource(inner, Path(tmp))

            self.assertEqual("v1", cache.fetch_resource("bv1", "r1")["content"])
            self.assertEqual("v2", cache.fetch_resource("bv2", "r1")["content"])
            self.assertEqual(2, inner.resource_fetches)  # 各版本各拉一次，不误用

    def test_body_shape_preserved_across_cache_roundtrip(self) -> None:
        with TemporaryDirectory() as tmp:
            body = {"resource_id": "r1", "content": "x", "extra": {"k": [1, 2]}}
            inner = FakeBundleSource(
                snapshots={"bv1": {"bundleVersionId": "bv1"}},
                resources={"bv1": {"r1": dict(body)}},
            )
            first = CachingBundleSource(inner, Path(tmp)).fetch_resource("bv1", "r1")

            # 新实例命中磁盘：body 形状（含嵌套 extra）经 JSON 往返一致
            second = CachingBundleSource(
                FakeBundleSource(
                    snapshots={"bv1": {"bundleVersionId": "bv1"}},
                    resources={"bv1": {"r1": dict(body)}},
                ),
                Path(tmp),
            ).fetch_resource("bv1", "r1")

            self.assertEqual(first, second)
            self.assertEqual({"k": [1, 2]}, second["extra"])

    def test_snapshot_is_passthrough_not_cached(self) -> None:
        # 发布快照不缓存：BundleVerifier 每次重算 manifestDigest，是安全锚点
        with TemporaryDirectory() as tmp:
            inner = _single_source()
            cache = CachingBundleSource(inner, Path(tmp))

            cache.fetch_snapshot("bv1")
            cache.fetch_snapshot("bv1")

            self.assertEqual(2, inner.snapshot_fetches)


class CachingBundleSourceTamperTest(unittest.TestCase):
    def _content_file(self, tmp: Path) -> Path:
        files = [
            f
            for f in tmp.rglob("*")
            if f.is_file() and f.name != "index.json" and not f.name.endswith(".tmp")
        ]
        self.assertEqual(1, len(files), "预期恰好一个正文文件")
        return files[0]

    def test_tampered_disk_content_discarded_and_refetched(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            inner = _single_source()
            cache = CachingBundleSource(inner, tmp_path)
            cache.fetch_resource("bv1", "r1")  # 落盘

            self._content_file(tmp_path).write_text("被篡改的字节", encoding="utf-8")

            body = cache.fetch_resource("bv1", "r1")  # 重算 sha256≠键名 → 丢弃回源

            self.assertEqual(_BODY_A, body["content"])  # 正确内容，非脏数据
            self.assertEqual(2, inner.resource_fetches)  # 回源一次

    def test_corrupt_index_refetches_silently(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            inner = _single_source()
            cache = CachingBundleSource(inner, tmp_path)
            cache.fetch_resource("bv1", "r1")

            for idx in tmp_path.rglob("index.json"):
                idx.unlink()  # 索引丢失 → 命中失败 → 静默回源重建

            body = cache.fetch_resource("bv1", "r1")

            self.assertEqual(_BODY_A, body["content"])
            self.assertEqual(2, inner.resource_fetches)

    def test_corrupt_index_json_refetches_silently(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            inner = _single_source()
            cache = CachingBundleSource(inner, tmp_path)
            cache.fetch_resource("bv1", "r1")

            for idx in tmp_path.rglob("index.json"):
                idx.write_text("{不是合法json", encoding="utf-8")

            body = cache.fetch_resource("bv1", "r1")

            self.assertEqual(_BODY_A, body["content"])


class CachingBundleSourceEvictionTest(unittest.TestCase):
    def test_size_bounded_evicts_oldest_namespaces(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            inner = FakeBundleSource(
                snapshots={f"bv{i}": {"bundleVersionId": f"bv{i}"} for i in range(6)},
                resources={
                    f"bv{i}": {"r1": {"resource_id": "r1", "content": f"版本{i}-{_BODY_B}"}}
                    for i in range(6)
                },
            )
            cache = CachingBundleSource(inner, tmp_path, max_bytes=1)

            for i in range(6):
                cache.fetch_resource(f"bv{i}", "r1")

            namespaces = [d for d in tmp_path.iterdir() if d.is_dir()]
            self.assertLess(len(namespaces), 6)  # 有淘汰，不无限增长
            # 最新版本仍可读（命中或回源都不丢数据）
            self.assertIn("版本5", cache.fetch_resource("bv5", "r1")["content"])

    def test_within_budget_keeps_all_namespaces(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            inner = FakeBundleSource(
                snapshots={f"bv{i}": {"bundleVersionId": f"bv{i}"} for i in range(3)},
                resources={
                    f"bv{i}": {"r1": {"resource_id": "r1", "content": f"v{i}"}}
                    for i in range(3)
                },
            )
            cache = CachingBundleSource(inner, tmp_path, max_bytes=10 * 1024 * 1024)

            for i in range(3):
                cache.fetch_resource(f"bv{i}", "r1")

            namespaces = [d for d in tmp_path.iterdir() if d.is_dir()]
            self.assertEqual(3, len(namespaces))  # 预算内不淘汰


class CachingBundleSourceWithGateTest(unittest.TestCase):
    """端到端：ResourceGate 经装饰层读 on_demand 资源，进程重启后命中磁盘缓存。

    断言装载器 / ResourceGate 不感知缓存（契约不变），且 Brief acceptance 的
    「checkpoint 恢复 / 进程重启后再次读取命中缓存、零网络」在闸门级成立。
    """

    def test_on_demand_read_hits_disk_cache_across_restart(self) -> None:
        with TemporaryDirectory() as tmp:
            snapshot = _make_snapshot()
            inner1 = _source(snapshot)
            gate1 = ResourceGate(
                _verified(snapshot),
                CachingBundleSource(inner1, Path(tmp)),
                initial_tokens=_initial_baseline_tokens(),
                initial_evidence=_initial_evidence(),
            )
            gate1.read("ref_rule")  # 首次 on_demand 读取，落盘

            # 模拟 Worker 进程重启：全新 inner + 同 cache_dir + 全新 ResourceGate
            inner2 = _source(snapshot)
            gate2 = ResourceGate(
                _verified(snapshot),
                CachingBundleSource(inner2, Path(tmp)),
                initial_tokens=_initial_baseline_tokens(),
                initial_evidence=_initial_evidence(),
            )
            content = gate2.read("ref_rule")

            self.assertEqual(REF_BODY, content)  # 内容正确，非脏数据
            self.assertEqual(0, inner2.resource_fetches)  # 命中磁盘，零网络


if __name__ == "__main__":
    unittest.main()
