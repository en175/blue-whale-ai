package com.blue.whale.agent.service.governance;

/**
 * ReviewEvidence 来源（ADR-0022）：本地非生产环境由确定性 Fake 实现提供，
 * 生产环境由真实审核供应商实现（不在 IK1NRZ 范围）。无论证据来源如何，
 * 最终决定都由 {@code ContentReviewService} 归一化并持久化。
 */
public interface ReviewEvidenceSource {

    ReviewEvidence produce(ReviewEvidenceRequest request);

    /**
     * 只校验请求已携带的流式证据，或在受控环境生成确定性证据；该方法运行在产品短事务内，
     * 实现不得执行网络 I/O。需要调用外部供应商的完整文本审核必须在事务外完成，再把最小化
     * 证据交给产品控制面接纳（ADR-0017）。
     */
    default ReviewEvidence produceAgentText(
            AgentTextReviewRequest request, String policyVersion) {
        return ReviewEvidence.failed(
                request.contentDigest(), "text", "output", policyVersion,
                "unavailable", "agent-text-review-unavailable");
    }
}
