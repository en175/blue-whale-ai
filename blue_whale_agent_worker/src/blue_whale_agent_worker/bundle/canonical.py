"""Runtime Agent Bundle 根摘要算法（契约 §3.3）。

与 Java ``RuntimeBundleDigests`` 逐字节对齐：对象键按字典序（UTF-16 码单元，
对 BMP 即 ``Comparator.naturalOrder()``）递归排序、数组保序、紧凑分隔符、UTF-8
输出，再 SHA-256，前缀 ``sha256:`` + 64 位小写十六进制。

参考实现：``RuntimeBundleDigests.canonicalize`` + ``ObjectMapper.writeValueAsBytes``
（紧凑模式）。manifestDigest 的计算对象是去除自身 ``manifestDigest`` 字段后的
resourceManifest。

等价性边界：Python ``json.dumps`` 的 ``sort_keys`` 按 Unicode 码点排序，``separators``
产出紧凑输出（无空格），``ensure_ascii=False`` 与 Jackson 直接输出 UTF-8 一致。
契约 v1 的 resourceManifest 字段均为 ASCII / BMP 键与整数值（formatVersion、revision、
sizeBytes、tokenEstimate 等），在此形状下与 Jackson 逐字节一致；golden 测试用 Java
IT 夹具（pin_agent_v2_0_0 manifest）锁定。若未来 manifest 出现浮点科学计数法、
非 BMP（代理对）键或 U+2028 / U+2029，Python ``json.dumps`` 可能与 Jackson 分叉，
届时需重新双侧对齐。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

MANIFEST_DIGEST_FIELD = "manifestDigest"


def canonical_json_digest(value: Any) -> str:
    """对任意 JSON 值做与 Jackson canonicalize 等价的规范化后 SHA-256。"""
    canonical = json.dumps(
        value, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def manifest_digest(resource_manifest: dict[str, Any]) -> str:
    """resourceManifest 的 manifestDigest：去除自身 ``manifestDigest`` 字段后规范化摘要。"""
    without_digest = {
        key: value
        for key, value in resource_manifest.items()
        if key != MANIFEST_DIGEST_FIELD
    }
    return canonical_json_digest(without_digest)
