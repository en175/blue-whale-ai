package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.model.entity.ContentReview;

import java.util.List;

/**
 * 本地非生产确定性 ReviewEvidence 来源：不调用任何真实审核供应商，
 * 对落盘内容摘要给出确定性通过证据。仅供 {@code blue-whale.generation.mode=fake} 装配。
 *
 * <p>确定性指令（经生成 input.prompt 驱动，用于本地演练与集成测试的 fail-closed 分支）：
 * <ul>
 *   <li>{@code fake:review-reject} — 给出 reject 证据（reason_code=custom_policy）</li>
 *   <li>{@code fake:review-invalid} — 给出摘要不匹配的证据（产品面判 invalid_evidence）</li>
 *   <li>{@code fake:review-unavailable} — 给出 unavailable 失败证据</li>
 * </ul>
 */
public class LocalFakeReviewEvidenceSource implements ReviewEvidenceSource {

    private static final String EVIDENCE_REF = "local-fake-review";

    private final ContentReviewProperties properties;

    public LocalFakeReviewEvidenceSource(ContentReviewProperties properties) {
        this.properties = properties;
    }

    @Override
    public ReviewEvidence produce(ReviewEvidenceRequest request) {
        String prompt = request.input() == null ? null : String.valueOf(request.input().get("prompt"));
        if ("fake:review-reject".equals(prompt)) {
            return ReviewEvidence.reject(
                    request.contentDigest(), ContentReview.MODALITY_IMAGE, ContentReview.DIRECTION_OUTPUT,
                    properties.getPolicyVersion(), List.of("custom_policy"), EVIDENCE_REF);
        }
        if ("fake:review-invalid".equals(prompt)) {
            return ReviewEvidence.pass(
                    "0".repeat(64), ContentReview.MODALITY_IMAGE, ContentReview.DIRECTION_OUTPUT,
                    properties.getPolicyVersion(), EVIDENCE_REF);
        }
        if ("fake:review-unavailable".equals(prompt)) {
            return ReviewEvidence.failed(
                    request.contentDigest(), ContentReview.MODALITY_IMAGE, ContentReview.DIRECTION_OUTPUT,
                    properties.getPolicyVersion(), "unavailable", EVIDENCE_REF);
        }
        return ReviewEvidence.pass(
                request.contentDigest(), ContentReview.MODALITY_IMAGE, ContentReview.DIRECTION_OUTPUT,
                properties.getPolicyVersion(), EVIDENCE_REF);
    }

    @Override
    public ReviewEvidence produceAgentText(
            AgentTextReviewRequest request, String policyVersion) {
        if ("fake:review-reject".equals(request.content())) {
            return ReviewEvidence.reject(
                    request.contentDigest(), "text", ContentReview.DIRECTION_OUTPUT,
                    policyVersion, List.of("custom_policy"), EVIDENCE_REF);
        }
        if ("fake:review-unavailable".equals(request.content())) {
            return ReviewEvidence.failed(
                    request.contentDigest(), "text", ContentReview.DIRECTION_OUTPUT,
                    policyVersion, "unavailable", EVIDENCE_REF);
        }
        return ReviewEvidence.pass(
                request.contentDigest(), "text", ContentReview.DIRECTION_OUTPUT,
                policyVersion, EVIDENCE_REF);
    }
}
