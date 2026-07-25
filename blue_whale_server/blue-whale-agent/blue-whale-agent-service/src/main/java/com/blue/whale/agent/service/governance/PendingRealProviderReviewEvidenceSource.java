package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.model.entity.ContentReview;

/**
 * 生产真实供应商尚未接入时的 fail-closed 占位证据源（ADR-0021 LLM Shield 未落地前）。
 *
 * <p>无条件返回 {@code unavailable} 失败证据：{@link ContentReviewService} 据此形成
 * STATE_FAILED 决定，{@code GenerationWorker} 走 {@code acceptFailure("content_review_unavailable")}
 * 分支，不创建 Asset。这保证真实图片供应商路径不会在审核能力缺位时绕过产品控制面
 * （ADR-0029）。待真实证据源接入后，该 bean 被替换或移除。
 *
 * <p>仅装配在 {@code blue-whale.generation.mode=openai-tos}（生产供应商模式）下；
 * {@code mode=fake} 由 {@link LocalFakeReviewEvidenceSource} 提供确定性证据。
 */
public class PendingRealProviderReviewEvidenceSource implements ReviewEvidenceSource {

    private static final String EVIDENCE_REF = "pending-real-provider";
    private static final String FAILURE_CODE = "unavailable";

    private final ContentReviewProperties properties;

    public PendingRealProviderReviewEvidenceSource(ContentReviewProperties properties) {
        this.properties = properties;
    }

    @Override
    public ReviewEvidence produce(ReviewEvidenceRequest request) {
        return ReviewEvidence.failed(
                request.contentDigest(),
                ContentReview.MODALITY_IMAGE,
                ContentReview.DIRECTION_OUTPUT,
                properties.getPolicyVersion(),
                FAILURE_CODE,
                EVIDENCE_REF);
    }

    @Override
    public ReviewEvidence produceAgentText(
            AgentTextReviewRequest request, String policyVersion) {
        return ReviewEvidence.failed(
                request.contentDigest(), "text", ContentReview.DIRECTION_OUTPUT,
                policyVersion, FAILURE_CODE, EVIDENCE_REF);
    }
}
