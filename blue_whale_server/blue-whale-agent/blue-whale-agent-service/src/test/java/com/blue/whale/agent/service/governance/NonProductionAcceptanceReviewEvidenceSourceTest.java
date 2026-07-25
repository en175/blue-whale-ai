package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.model.entity.ContentReview;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 受控真实验收的非生产证据源（IK1NS3）：对已私有落盘的真实生成内容给出与
 * 内容摘要、模态、方向和当前策略版本完全匹配的确定性 pass 证据。
 * 证据本身不放行内容——最终决定仍由 ContentReviewService 归一化并持久化。
 */
class NonProductionAcceptanceReviewEvidenceSourceTest {

    private static final String DIGEST = "a".repeat(64);

    private final ContentReviewProperties properties = new ContentReviewProperties();
    private final NonProductionAcceptanceReviewEvidenceSource source =
            new NonProductionAcceptanceReviewEvidenceSource(properties);

    @Test
    void producesPassEvidenceMatchingRequestFacts() {
        ReviewEvidenceRequest request = new ReviewEvidenceRequest(
                1L, 2L, 3L, 0, DIGEST, "image/png", Map.of("prompt", "合成验收提示词"));

        ReviewEvidence evidence = source.produce(request);

        assertThat(evidence.verdict()).isEqualTo(ReviewEvidence.VERDICT_PASS);
        assertThat(evidence.failureCode()).isNull();
        assertThat(evidence.reasonCodes()).isEmpty();
        assertThat(evidence.contentDigest()).isEqualTo(DIGEST);
        assertThat(evidence.modality()).isEqualTo(ContentReview.MODALITY_IMAGE);
        assertThat(evidence.direction()).isEqualTo(ContentReview.DIRECTION_OUTPUT);
        assertThat(evidence.policyVersion()).isEqualTo(properties.getPolicyVersion());
        assertThat(evidence.evidenceRef())
                .isEqualTo(NonProductionAcceptanceReviewEvidenceSource.EVIDENCE_REF);
    }

    @Test
    void bindsConfiguredPolicyVersion() {
        properties.setPolicyVersion("acceptance-policy-v2");

        ReviewEvidence evidence = source.produce(new ReviewEvidenceRequest(
                1L, 2L, 3L, 0, DIGEST, "image/png", Map.of()));

        assertThat(evidence.policyVersion()).isEqualTo("acceptance-policy-v2");
    }

    @Test
    void evidenceRefIdentifiesNonProductionAcceptance() {
        assertThat(NonProductionAcceptanceReviewEvidenceSource.EVIDENCE_REF)
                .isEqualTo("non-production-acceptance-review");
    }
}
