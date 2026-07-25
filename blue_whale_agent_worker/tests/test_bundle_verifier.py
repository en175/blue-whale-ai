import unittest

from blue_whale_agent_worker.bundle.canonical import manifest_digest
from blue_whale_agent_worker.bundle.errors import (
    BUNDLE_MANIFEST_DIGEST_MISMATCH,
    BUNDLE_VERSION_PIN_MISMATCH,
    BundleError,
)
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from blue_whale_agent_worker.bundle.verifier import BundleVerifier, VerifiedSnapshot


def _make_manifest() -> dict:
    return {
        "formatVersion": 1,
        "baseUri": "bw-bundle://pin_agent_v2_0_0/",
        "digestAlgorithm": "sha256",
        "resources": [],
    }


def _digest(manifest: dict | None = None) -> str:
    return manifest_digest(manifest or _make_manifest())


def _make_snapshot(
    bundle_version_id: str = "pin_agent_v2_0_0", manifest: dict | None = None
) -> dict:
    manifest = dict(manifest or _make_manifest())
    manifest["manifestDigest"] = manifest_digest(manifest)
    return {
        "bundleVersionId": bundle_version_id,
        "composition": {
            "resourceManifest": manifest,
            "modelProfiles": [{"modelProfileId": "model_v2", "version": "2.0.0"}],
        },
    }


class BundleVerifierTest(unittest.TestCase):
    def setUp(self) -> None:
        self.snapshot = _make_snapshot()
        self.source = FakeBundleSource(
            snapshots={"pin_agent_v2_0_0": self.snapshot}
        )
        self.verifier = BundleVerifier(self.source)

    def test_verify_returns_verified_snapshot_when_pin_matches(self) -> None:
        verified = self.verifier.verify("pin_agent_v2_0_0", _digest())

        self.assertIsInstance(verified, VerifiedSnapshot)
        self.assertEqual("pin_agent_v2_0_0", verified.bundle_version_id)
        self.assertEqual(_digest(), verified.manifest_digest)
        self.assertEqual(self.snapshot, verified.snapshot)

    def test_bundle_version_pin_mismatch_raises(self) -> None:
        with self.assertRaises(BundleError) as ctx:
            self.verifier.verify("pin_agent_v_other", _digest())

        self.assertEqual(BUNDLE_VERSION_PIN_MISMATCH, ctx.exception.code)

    def test_missing_snapshot_raises_pin_mismatch(self) -> None:
        verifier = BundleVerifier(FakeBundleSource())

        with self.assertRaises(BundleError) as ctx:
            verifier.verify("pin_agent_v2_0_0", _digest())

        self.assertEqual(BUNDLE_VERSION_PIN_MISMATCH, ctx.exception.code)

    def test_source_exception_raises_pin_mismatch_without_fallback(self) -> None:
        class BoomSource:
            def fetch_snapshot(self, bundle_version_id: str):
                raise RuntimeError("connection reset")

        verifier = BundleVerifier(BoomSource())  # type: ignore[arg-type]

        with self.assertRaises(BundleError) as ctx:
            verifier.verify("pin_agent_v2_0_0", _digest())

        self.assertEqual(BUNDLE_VERSION_PIN_MISMATCH, ctx.exception.code)

    def test_tampered_manifest_digest_raises_digest_mismatch(self) -> None:
        tampered = _make_snapshot()
        tampered["composition"]["resourceManifest"]["manifestDigest"] = "sha256:deadbeef"
        verifier = BundleVerifier(
            FakeBundleSource(snapshots={"pin_agent_v2_0_0": tampered})
        )

        with self.assertRaises(BundleError) as ctx:
            verifier.verify("pin_agent_v2_0_0", "sha256:deadbeef")

        self.assertEqual(BUNDLE_MANIFEST_DIGEST_MISMATCH, ctx.exception.code)

    def test_run_pin_digest_mismatch_raises_digest_mismatch(self) -> None:
        with self.assertRaises(BundleError) as ctx:
            self.verifier.verify("pin_agent_v2_0_0", "sha256:differentfrompin000")

        self.assertEqual(BUNDLE_MANIFEST_DIGEST_MISMATCH, ctx.exception.code)

    def test_missing_resource_manifest_raises_digest_mismatch(self) -> None:
        broken = {"bundleVersionId": "pin_agent_v2_0_0", "composition": {}}
        verifier = BundleVerifier(
            FakeBundleSource(snapshots={"pin_agent_v2_0_0": broken})
        )

        with self.assertRaises(BundleError) as ctx:
            verifier.verify("pin_agent_v2_0_0", _digest())

        self.assertEqual(BUNDLE_MANIFEST_DIGEST_MISMATCH, ctx.exception.code)

    def test_error_message_does_not_leak_snapshot_body_or_private_path(self) -> None:
        secret = "TOP_SECRET_ROLE_DOCUMENT_BODY"
        tampered = _make_snapshot()  # 自带 digest 与原 manifest 一致
        # digest 固化后再注入敏感正文：重算将与自带值不一致 → 自洽失败
        tampered["composition"]["resourceManifest"]["resources"] = [{"content": secret}]
        verifier = BundleVerifier(
            FakeBundleSource(snapshots={"pin_agent_v2_0_0": tampered})
        )

        with self.assertRaises(BundleError) as ctx:
            verifier.verify("pin_agent_v2_0_0", _digest())

        self.assertNotIn(secret, ctx.exception.message)
        self.assertNotIn("bw-bundle://", ctx.exception.message)


if __name__ == "__main__":
    unittest.main()
