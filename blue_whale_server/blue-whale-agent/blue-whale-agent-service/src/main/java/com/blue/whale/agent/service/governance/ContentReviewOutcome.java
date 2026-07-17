package com.blue.whale.agent.service.governance;

/**
 * 内容审核结果：只有 {@link Status#PASSED} 允许创建 Asset；其余一律 fail closed。
 *
 * @param failureCode 审核失败码（仅 {@link Status#FAILED} 非空）
 */
public record ContentReviewOutcome(Status status, String failureCode) {

    public enum Status {
        PASSED,
        REJECTED,
        FAILED
    }

    public static ContentReviewOutcome passed() {
        return new ContentReviewOutcome(Status.PASSED, null);
    }

    public static ContentReviewOutcome rejected() {
        return new ContentReviewOutcome(Status.REJECTED, null);
    }

    public static ContentReviewOutcome failed(String failureCode) {
        return new ContentReviewOutcome(Status.FAILED, failureCode);
    }
}
