package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.ContentReviewMapper;
import com.blue.whale.agent.model.entity.ContentReview;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * ContentReview fail-closed 语义单测：证据源缺失或返回失败证据时不得放行（ADR-0029）。
 * 覆盖生产占位证据源（PendingRealProviderReviewEvidenceSource）的 fail-closed 行为，
 * 以及证据源完全未装配时的防御性 fail closed。
 */
class ContentReviewServiceTest {

    private static final String POLICY_VERSION = "local-fake-v1";
    private static final String DIGEST = "a".repeat(64);

    private final ContentReviewMapper mapper = mock(ContentReviewMapper.class);
    private final AuditRecordWriter auditRecordWriter = mock(AuditRecordWriter.class);
    private final ContentReviewProperties properties = new ContentReviewProperties();

    private ReviewEvidenceRequest request() {
        return new ReviewEvidenceRequest(
                1L, 2L, 3L, 0, DIGEST, "image/png", Map.of("prompt", "whale"));
    }

    private ContentReviewService serviceWith(ReviewEvidenceSource source) {
        ObjectProvider<ReviewEvidenceSource> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(source);
        return new ContentReviewService(mapper, auditRecordWriter, properties, provider);
    }

    @Test
    void missingEvidenceSourceFailsClosed() {
        ContentReviewService service = serviceWith(null);
        when(mapper.selectByIdentityForUpdate(
                any(), any(), any(), any(), any(), any(), any())).thenReturn(null);

        // 证据源未装配：fail closed，绝不在无审核能力时放行创建 Asset
        assertThatThrownBy(() -> service.reviewGeneratedImage(request()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("证据源");
    }

    @Test
    void pendingRealProviderEvidenceSourceYieldsUnavailableFailure() {
        // 生产占位证据源（真实 LLM Shield 未接入前）返回 unavailable → fail closed
        PendingRealProviderReviewEvidenceSource source =
                new PendingRealProviderReviewEvidenceSource(properties);
        ContentReviewService service = serviceWith(source);
        when(mapper.selectByIdentityForUpdate(
                any(), any(), any(), any(), any(), any(), any())).thenReturn(null);

        ContentReviewOutcome outcome = service.reviewGeneratedImage(request());

        assertThat(outcome.status()).isEqualTo(ContentReviewOutcome.Status.FAILED);
        assertThat(outcome.failureCode()).isEqualTo("unavailable");
    }

    @Test
    void passingEvidenceYieldsPassedOutcome() {
        ReviewEvidenceSource source = req -> ReviewEvidence.pass(
                req.contentDigest(),
                ContentReview.MODALITY_IMAGE,
                ContentReview.DIRECTION_OUTPUT,
                POLICY_VERSION,
                "test-evidence");
        ContentReviewService service = serviceWith(source);
        when(mapper.selectByIdentityForUpdate(
                any(), any(), any(), any(), any(), any(), any())).thenReturn(null);

        ContentReviewOutcome outcome = service.reviewGeneratedImage(request());

        assertThat(outcome.status()).isEqualTo(ContentReviewOutcome.Status.PASSED);
    }
}
