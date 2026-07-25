import hashlib
import unittest

from blue_whale_agent_worker.bundle.canonical import (
    canonical_json_digest,
    manifest_digest,
)


class CanonicalJsonDigestTest(unittest.TestCase):
    def test_matches_java_runtime_bundle_digests_golden_v2(self) -> None:
        # 对齐 RuntimeBundleAgentRunPinIT.insertVersion：digest 在 manifestDigest 字段
        # 写入前计算（IT 第 144-145 行）。Java RuntimeBundleDigests.canonicalize 对象键
        # naturalOrder 排序、数组保序、紧凑 UTF-8 后 SHA-256。此 hex 由同一算法在本地复算。
        manifest = {
            "formatVersion": 1,
            "baseUri": "bw-bundle://pin_agent_v2_0_0/",
            "digestAlgorithm": "sha256",
            "resources": [],
        }
        self.assertEqual(
            canonical_json_digest(manifest),
            "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
        )

    def test_matches_java_runtime_bundle_digests_golden_v1(self) -> None:
        manifest = {
            "formatVersion": 1,
            "baseUri": "bw-bundle://pin_agent_v1_0_0/",
            "digestAlgorithm": "sha256",
            "resources": [],
        }
        self.assertEqual(
            canonical_json_digest(manifest),
            "sha256:8931db5734a82e170f8cafb6e659a04113e0370d82b7b58e0144c0c56293f59a",
        )

    def test_object_keys_recursively_sorted(self) -> None:
        # 键顺序不影响摘要（与 Jackson naturalOrder 对齐）
        self.assertEqual(
            canonical_json_digest({"b": 1, "a": {"d": 2, "c": 3}}),
            canonical_json_digest({"a": {"c": 3, "d": 2}, "b": 1}),
        )

    def test_array_order_preserved(self) -> None:
        # 数组顺序参与摘要（保序，不排序）
        self.assertNotEqual(
            canonical_json_digest({"arr": [1, 2, 3]}),
            canonical_json_digest({"arr": [3, 2, 1]}),
        )

    def test_compact_separators_match_jackson(self) -> None:
        # 紧凑分隔符（冒号 / 逗号后无空格），与 Jackson writeValueAsBytes 默认一致
        self.assertEqual(
            canonical_json_digest({"a": 1, "b": 2}),
            "sha256:" + hashlib.sha256(b'{"a":1,"b":2}').hexdigest(),
        )


class ManifestDigestTest(unittest.TestCase):
    def test_excludes_manifest_digest_field(self) -> None:
        with_field = {
            "manifestDigest": "sha256:deadbeef",
            "formatVersion": 1,
            "resources": [],
        }
        self.assertEqual(
            manifest_digest(with_field),
            canonical_json_digest({"formatVersion": 1, "resources": []}),
        )

    def test_publisher_round_trip(self) -> None:
        # 发布器先算 digest 再塞回 manifestDigest；Worker 重算时忽略该字段得到相同摘要
        manifest = {
            "formatVersion": 1,
            "baseUri": "bw-bundle://pin_agent_v2_0_0/",
            "digestAlgorithm": "sha256",
            "resources": [],
        }
        manifest["manifestDigest"] = manifest_digest(manifest)
        self.assertEqual(
            manifest_digest(manifest),
            "sha256:8006db9d6124eb5fb807a90165f4c01df48e68c65117991c1f42970ed22b3657",
        )


if __name__ == "__main__":
    unittest.main()
