package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.ContentReviewMapper;
import com.blue.whale.agent.model.entity.ContentReview;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

/**
 * ContentReview 产品控制面（ADR-0022 / ADR-0029）：对生成媒体形成规范化、可持久化的
 * 产品决定。同一逻辑身份（内容摘要 + 模态 + 方向 + 策略版本 + 受审主体）复用既有决定；
 * 证据缺失、过期、无法验证或不足以覆盖当前策略时 fail closed，只有 decided + pass
 * 才返回 {@link ContentReviewOutcome.Status#PASSED}。
 */
@Service
@RequiredArgsConstructor
public class ContentReviewService {

    /** 审核失败：证据无效 */
    public static final String FAILURE_INVALID_EVIDENCE = "invalid_evidence";

    private final ContentReviewMapper contentReviewMapper;
    private final AuditRecordWriter auditRecordWriter;
    private final ContentReviewProperties properties;
    private final ObjectProvider<ReviewEvidenceSource> evidenceSourceProvider;

    /**
     * 对供应商返回并已私有落盘的生成图片形成审核决定。同一身份已存在终态审核时直接复用，
     * 不产生第二次外部审核调用，也不重复写审计。
     */
    @Transactional
    public ContentReviewOutcome reviewGeneratedImage(ReviewEvidenceRequest request) {
        validateRequest(request);
        String policyVersion = properties.getPolicyVersion();
        String subjectId = subjectId(request.jobId(), request.slotIndex());
        ContentReview existing = contentReviewMapper.selectByIdentityForUpdate(
                request.projectId(), ContentReview.SUBJECT_TYPE_GENERATION_OUTPUT, subjectId,
                request.contentDigest(), ContentReview.MODALITY_IMAGE,
                ContentReview.DIRECTION_OUTPUT, policyVersion);
        if (existing != null) {
            return outcomeOf(existing);
        }
        ReviewEvidenceSource source = evidenceSourceProvider.getIfAvailable();
        if (source == null) {
            throw new IllegalStateException("内容审核证据源未配置");
        }
        ReviewEvidence evidence = source.produce(request);
        ContentReview review = new ContentReview()
                .setProjectId(request.projectId())
                .setUserId(request.userId())
                .setSubjectType(ContentReview.SUBJECT_TYPE_GENERATION_OUTPUT)
                .setSubjectId(subjectId)
                .setContentDigest(request.contentDigest())
                .setModality(ContentReview.MODALITY_IMAGE)
                .setDirection(ContentReview.DIRECTION_OUTPUT)
                .setPolicyVersion(policyVersion);
        if (!isValid(evidence, request, policyVersion)) {
            review.setReviewState(ContentReview.STATE_FAILED)
                    .setFailureCode(FAILURE_INVALID_EVIDENCE);
            contentReviewMapper.insert(review);
            auditRecordWriter.appendContentReviewDecision(
                    review, request.jobId(), "denied", FAILURE_INVALID_EVIDENCE);
            return ContentReviewOutcome.failed(FAILURE_INVALID_EVIDENCE);
        }
        review.setEvidenceRef(evidence.evidenceRef());
        if (evidence.failureCode() != null) {
            review.setReviewState(ContentReview.STATE_FAILED)
                    .setFailureCode(evidence.failureCode());
            contentReviewMapper.insert(review);
            auditRecordWriter.appendContentReviewDecision(
                    review, request.jobId(), "denied", evidence.failureCode());
            return ContentReviewOutcome.failed(evidence.failureCode());
        }
        review.setReviewState(ContentReview.STATE_DECIDED)
                .setDecision(evidence.verdict())
                .setReasonCodes(evidence.reasonCodes());
        contentReviewMapper.insert(review);
        if (ContentReview.DECISION_PASS.equals(evidence.verdict())) {
            auditRecordWriter.appendContentReviewDecision(
                    review, request.jobId(), "allowed", "CONTENT_REVIEW_PASS");
            return ContentReviewOutcome.passed();
        }
        auditRecordWriter.appendContentReviewDecision(
                review, request.jobId(), "denied", evidence.reasonCodes().get(0));
        return ContentReviewOutcome.rejected();
    }

    /**
     * 对 Assistant 文本形成可复用的产品审核决定；原文只停留在私有分块表。
     *
     * <p>decided（pass / reject）是终态，按逻辑身份复用；failed 不是终态——审核暂时不可用
     * 不形成永久决定，恢复后按同一身份重审并更新同一行（uk_content_review_identity 保证
     * 一个身份只有一行），配合 AssistantMessageStream 的同幂等键重试完成真正的失败恢复。
     */
    @Transactional
    public ContentReviewOutcome reviewAgentText(AgentTextReviewRequest request) {
        validateAgentTextRequest(request);
        String policyVersion = properties.getPolicyVersion();
        ContentReview review = contentReviewMapper.selectByIdentityForUpdate(
                request.projectId(), ContentReview.SUBJECT_TYPE_AGENT_TEXT, request.subjectId(),
                request.contentDigest(), ContentReview.MODALITY_TEXT,
                ContentReview.DIRECTION_OUTPUT, policyVersion);
        if (review != null && ContentReview.STATE_DECIDED.equals(review.getReviewState())) {
            return outcomeOf(review);
        }
        boolean persisted = review != null;
        if (!persisted) {
            review = new ContentReview()
                    .setProjectId(request.projectId())
                    .setUserId(request.userId())
                    .setSubjectType(ContentReview.SUBJECT_TYPE_AGENT_TEXT)
                    .setSubjectId(request.subjectId())
                    .setContentDigest(request.contentDigest())
                    .setModality(ContentReview.MODALITY_TEXT)
                    .setDirection(ContentReview.DIRECTION_OUTPUT)
                    .setPolicyVersion(policyVersion);
        }
        ReviewEvidenceSource source = evidenceSourceProvider.getIfAvailable();
        if (source == null) {
            return failAgentTextReview(review, persisted, request, "unavailable");
        }
        ReviewEvidence evidence = source.produceAgentText(request, policyVersion);
        if (!isValid(evidence, request.contentDigest(), ContentReview.MODALITY_TEXT, policyVersion)) {
            return failAgentTextReview(review, persisted, request, FAILURE_INVALID_EVIDENCE);
        }
        review.setEvidenceRef(evidence.evidenceRef());
        if (evidence.failureCode() != null) {
            return failAgentTextReview(review, persisted, request, evidence.failureCode());
        }
        review.setReviewState(ContentReview.STATE_DECIDED)
                .setDecision(evidence.verdict())
                .setReasonCodes(evidence.reasonCodes())
                .setFailureCode(null);
        persistAgentTextReview(review, persisted);
        if (ContentReview.DECISION_PASS.equals(evidence.verdict())) {
            auditRecordWriter.appendContentReviewDecision(
                    review, "assistant-stream:" + request.streamId(),
                    "allowed", "CONTENT_REVIEW_PASS");
            return ContentReviewOutcome.passed();
        }
        auditRecordWriter.appendContentReviewDecision(
                review, "assistant-stream:" + request.streamId(),
                "denied", evidence.reasonCodes().get(0));
        return ContentReviewOutcome.rejected();
    }

    private ContentReviewOutcome failAgentTextReview(
            ContentReview review, boolean persisted,
            AgentTextReviewRequest request, String failureCode) {
        review.setReviewState(ContentReview.STATE_FAILED)
                .setDecision(null)
                .setReasonCodes(null)
                .setFailureCode(failureCode);
        persistAgentTextReview(review, persisted);
        auditRecordWriter.appendContentReviewDecision(
                review, "assistant-stream:" + request.streamId(), "denied", failureCode);
        return ContentReviewOutcome.failed(failureCode);
    }

    private void persistAgentTextReview(ContentReview review, boolean persisted) {
        if (persisted) {
            contentReviewMapper.updateById(review);
        } else {
            contentReviewMapper.insert(review);
        }
    }

    static String subjectId(Long jobId, int slotIndex) {
        return "generation-job:" + jobId + ":slot:" + slotIndex;
    }

    private ContentReviewOutcome outcomeOf(ContentReview review) {
        if (ContentReview.STATE_DECIDED.equals(review.getReviewState())) {
            return ContentReview.DECISION_PASS.equals(review.getDecision())
                    ? ContentReviewOutcome.passed() : ContentReviewOutcome.rejected();
        }
        if (ContentReview.STATE_FAILED.equals(review.getReviewState())) {
            return ContentReviewOutcome.failed(review.getFailureCode());
        }
        // pending 不可能出现在本实现（决定同步形成）；防御性 fail closed
        return ContentReviewOutcome.failed(FAILURE_INVALID_EVIDENCE);
    }

    private boolean isValid(
            ReviewEvidence evidence, ReviewEvidenceRequest request, String policyVersion) {
        return isValid(evidence, request.contentDigest(), ContentReview.MODALITY_IMAGE, policyVersion);
    }

    private boolean isValid(
            ReviewEvidence evidence, String contentDigest, String modality, String policyVersion) {
        if (evidence == null
                || !Objects.equals(evidence.contentDigest(), contentDigest)
                || !modality.equals(evidence.modality())
                || !ContentReview.DIRECTION_OUTPUT.equals(evidence.direction())
                || !Objects.equals(evidence.policyVersion(), policyVersion)) {
            return false;
        }
        if (evidence.failureCode() != null) {
            return evidence.verdict() == null
                    && ReviewEvidence.KNOWN_FAILURE_CODES.contains(evidence.failureCode());
        }
        if (ReviewEvidence.VERDICT_PASS.equals(evidence.verdict())) {
            return evidence.reasonCodes() == null || evidence.reasonCodes().isEmpty();
        }
        if (ReviewEvidence.VERDICT_REJECT.equals(evidence.verdict())) {
            return evidence.reasonCodes() != null && !evidence.reasonCodes().isEmpty()
                    && ReviewEvidence.KNOWN_REASON_CODES.containsAll(evidence.reasonCodes());
        }
        return false;
    }

    private void validateRequest(ReviewEvidenceRequest request) {
        boolean valid = request != null
                && request.projectId() != null
                && request.userId() != null
                && request.jobId() != null
                && request.slotIndex() >= 0
                && request.contentDigest() != null
                && request.contentDigest().matches("[0-9a-f]{64}")
                && request.mimeType() != null && request.mimeType().startsWith("image/");
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "内容审核请求无效");
        }
    }

    private void validateAgentTextRequest(AgentTextReviewRequest request) {
        boolean valid = request != null
                && request.projectId() != null
                && request.userId() != null
                && request.agentRunId() != null
                && request.streamId() != null && !request.streamId().isBlank()
                && request.subjectId() != null && !request.subjectId().isBlank()
                && request.content() != null
                && request.contentDigest() != null
                && request.contentDigest().matches("[0-9a-f]{64}");
        if (!valid) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "内容审核请求无效");
        }
    }
}
