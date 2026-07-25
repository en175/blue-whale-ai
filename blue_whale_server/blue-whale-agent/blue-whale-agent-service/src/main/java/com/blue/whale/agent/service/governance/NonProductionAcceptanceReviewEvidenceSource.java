package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.model.entity.ContentReview;

/**
 * 受控真实图片验收（IK1NS3）的显式非生产 ReviewEvidence 来源：不调用任何真实
 * 审核供应商，对真实供应商返回并已私有落盘的内容摘要给出确定性 pass 证据。
 * 仅装配在 {@code blue-whale.generation.mode=openai-tos} 且显式
 * {@code acceptance-allowed=true} 的非生产环境；生产 profile 拒绝该组合启动。
 *
 * <p>这不是 ContentReview 旁路：证据仍须与内容摘要、模态、方向和当前策略版本
 * 完全匹配，最终决定由 {@link ContentReviewService} 归一化、持久化并写审计；
 * 生产真实模式（acceptance-allowed=false）继续由
 * {@link PendingRealProviderReviewEvidenceSource} fail closed。
 *
 * <p>证据引用固定为 {@value #EVIDENCE_REF}，只承载规范化事实，不包含提示词、
 * 媒体、凭据、临时 URL 或供应商原始响应。
 */
public class NonProductionAcceptanceReviewEvidenceSource implements ReviewEvidenceSource {

    public static final String EVIDENCE_REF = "non-production-acceptance-review";

    private final ContentReviewProperties properties;

    public NonProductionAcceptanceReviewEvidenceSource(ContentReviewProperties properties) {
        this.properties = properties;
    }

    @Override
    public ReviewEvidence produce(ReviewEvidenceRequest request) {
        return ReviewEvidence.pass(
                request.contentDigest(),
                ContentReview.MODALITY_IMAGE,
                ContentReview.DIRECTION_OUTPUT,
                properties.getPolicyVersion(),
                EVIDENCE_REF);
    }

    @Override
    public ReviewEvidence produceAgentText(
            AgentTextReviewRequest request, String policyVersion) {
        return ReviewEvidence.pass(
                request.contentDigest(), "text", ContentReview.DIRECTION_OUTPUT,
                policyVersion, EVIDENCE_REF);
    }
}
