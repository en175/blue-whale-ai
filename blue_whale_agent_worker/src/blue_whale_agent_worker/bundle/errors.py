"""Runtime Agent Bundle 规范化错误（契约 §6 / IK2QBI）。

错误码面向 Java 控制面与审计；``message`` 不携带快照正文或私有路径，避免故障报告
本身成为信息泄露面。Worker 边界捕获 ``BundleError`` 后映射为提交给 Java 的规范化错误。
"""

from __future__ import annotations

# AgentRun 固定的 bundleVersionId 与 Worker 拉到的快照不一致，或快照缺失。
BUNDLE_VERSION_PIN_MISMATCH = "BUNDLE_VERSION_PIN_MISMATCH"
# 本地重算的 manifestDigest 与快照自带值或 Run pin 固定值不一致（摘要篡改或版本漂移）。
BUNDLE_MANIFEST_DIGEST_MISMATCH = "BUNDLE_MANIFEST_DIGEST_MISMATCH"


class BundleError(Exception):
    """规范化 Bundle 错误：``code`` 面向 Java / 审计，``message`` 不含敏感原文。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
