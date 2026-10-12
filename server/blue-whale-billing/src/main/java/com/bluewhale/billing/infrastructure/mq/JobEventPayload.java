package com.bluewhale.billing.infrastructure.mq;

public final class JobEventPayload {

    private JobEventPayload() {
    }

    public record JobFailed(long jobId, long userId, String reason) {

        public JobFailed {
            reason = reason == null || reason.isBlank() ? "未提供原因" : reason;
        }
    }
}
