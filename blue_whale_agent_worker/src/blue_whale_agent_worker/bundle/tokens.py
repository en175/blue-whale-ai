"""Bundle token 估算（契约 §4.2 / IK2QBJ + IK2QBM）。

按快照 ``TokenBudget.estimator`` 执行；当前仅 ``chars_div_4``，与 Java 发布侧
``RuntimeBundleValidator.estimateTokens`` 逐字节一致：空串 0，否则
``max(1, (len + 3) // 4)``。基础上下文装载器与受限读取闸门共享同一实现，避免
初始预算门与活动预算门两侧估算漂移。
"""

from __future__ import annotations


def estimate_chars_div_4(text: str) -> int:
    return 0 if not text else max(1, (len(text) + 3) // 4)
