package com.blue.whale.agent.service.governance;

import java.util.List;
import java.util.Set;

/**
 * ReviewEvidence（ADR-0022）：证据源对受审内容给出的可验证审核证据。
 * 供应商不能直接放行，最终决定由产品控制面归一化并持久化。
 *
 * <p>{@code verdict} 与 {@code failureCode} 互斥：证据要么给出 pass/reject 判定，
 * 要么表达审核失败原因；两者皆空或同时非空都是无效证据（fail closed）。
 */
public record ReviewEvidence(
        String contentDigest,
        String modality,
        String direction,
        String policyVersion,
        String verdict,
        List<String> reasonCodes,
        String failureCode,
        String evidenceRef) {

    public static final String VERDICT_PASS = "pass";
    public static final String VERDICT_REJECT = "reject";

    /** ADR-0029 规范化审核失败码 */
    public static final Set<String> KNOWN_FAILURE_CODES = Set.of(
            "timeout", "unavailable", "rate_limited", "invalid_evidence",
            "invalid_request", "authentication_failed", "authorization_failed");

    /** ADR-0029 产品规范化安全原因码（仅 reject 携带） */
    public static final Set<String> KNOWN_REASON_CODES = Set.of(
            "sexual_content", "minor_safety", "violence", "self_harm",
            "hate_or_harassment", "illegal_or_regulated", "privacy_or_sensitive_data",
            "fraud_or_impersonation", "cyber_abuse", "prompt_attack",
            "resource_abuse", "custom_policy", "unclassified_policy_risk");

    public static ReviewEvidence pass(
            String contentDigest, String modality, String direction,
            String policyVersion, String evidenceRef) {
        return new ReviewEvidence(
                contentDigest, modality, direction, policyVersion,
                VERDICT_PASS, List.of(), null, evidenceRef);
    }

    public static ReviewEvidence reject(
            String contentDigest, String modality, String direction,
            String policyVersion, List<String> reasonCodes, String evidenceRef) {
        return new ReviewEvidence(
                contentDigest, modality, direction, policyVersion,
                VERDICT_REJECT, reasonCodes, null, evidenceRef);
    }

    public static ReviewEvidence failed(
            String contentDigest, String modality, String direction,
            String policyVersion, String failureCode, String evidenceRef) {
        return new ReviewEvidence(
                contentDigest, modality, direction, policyVersion,
                null, null, failureCode, evidenceRef);
    }
}
