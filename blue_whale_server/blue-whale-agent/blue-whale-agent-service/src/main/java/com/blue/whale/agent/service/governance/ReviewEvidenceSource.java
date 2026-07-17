package com.blue.whale.agent.service.governance;

/**
 * ReviewEvidence 来源（ADR-0022）：本地非生产环境由确定性 Fake 实现提供，
 * 生产环境由真实审核供应商实现（不在 IK1NRZ 范围）。无论证据来源如何，
 * 最终决定都由 {@code ContentReviewService} 归一化并持久化。
 */
public interface ReviewEvidenceSource {

    ReviewEvidence produce(ReviewEvidenceRequest request);
}
