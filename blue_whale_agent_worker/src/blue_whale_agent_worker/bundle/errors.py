"""Runtime Agent Bundle 规范化错误（契约 §6 / IK2QBI）。

错误码面向 Java 控制面与审计；``message`` 不携带快照正文或私有路径，避免故障报告
本身成为信息泄露面。Worker 边界捕获 ``BundleError`` 后映射为提交给 Java 的规范化错误。
"""

from __future__ import annotations

# AgentRun 固定的 bundleVersionId 与 Worker 拉到的快照不一致，或快照缺失。
BUNDLE_VERSION_PIN_MISMATCH = "BUNDLE_VERSION_PIN_MISMATCH"
# 本地重算的 manifestDigest 与快照自带值或 Run pin 固定值不一致（摘要篡改或版本漂移）。
BUNDLE_MANIFEST_DIGEST_MISMATCH = "BUNDLE_MANIFEST_DIGEST_MISMATCH"
# 初始 / 单资源 / 活动上下文 token 预算超限（契约 §4.2：fail closed，不静默截断）。
BUNDLE_TOKEN_BUDGET_EXCEEDED = "BUNDLE_TOKEN_BUDGET_EXCEEDED"
# ModelProfile 缺少运行 Agent 必需的能力（如 tool_calling），调用模型前 fail closed。
MODEL_CAPABILITY_INSUFFICIENT = "MODEL_CAPABILITY_INSUFFICIENT"
# manifest 登记的资源在发布快照中找不到正文（缺失 / 源端异常）。
BUNDLE_RESOURCE_UNKNOWN = "BUNDLE_RESOURCE_UNKNOWN"
# 按需读取时重算的内容摘要与 manifest 固化值不一致（正文被篡改 / 版本错位）。
BUNDLE_RESOURCE_DIGEST_MISMATCH = "BUNDLE_RESOURCE_DIGEST_MISMATCH"
# 发布快照结构损坏：必需字段缺失 / 类型不符 / Run pin 指向对象不在快照内。
BUNDLE_SNAPSHOT_MALFORMED = "BUNDLE_SNAPSHOT_MALFORMED"
# 已固定 Creative Skill 版本的正文或引用资源字节缺失（契约 §8：100311，fail closed）。
# Creative Skill 独立于 Runtime Bundle，但其读取错误同样经 BundleError → Orchestrator
# _failure 通道归一化为 commit error.code（不并入 Bundle manifest）。
CREATIVE_SKILL_CONTENT_MISSING = "CREATIVE_SKILL_CONTENT_MISSING"
# Creative Skill 读取内容摘要与固定摘要不符（契约 §8：100312，fail closed）。
CREATIVE_SKILL_DIGEST_MISMATCH = "CREATIVE_SKILL_DIGEST_MISMATCH"


class BundleError(Exception):
    """规范化 Bundle 错误：``code`` 面向 Java / 审计，``message`` 不含敏感原文。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
