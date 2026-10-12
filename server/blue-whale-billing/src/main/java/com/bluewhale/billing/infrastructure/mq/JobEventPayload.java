package com.bluewhale.billing.infrastructure.mq;

public final class JobEventPayload {

    private JobEventPayload() {
    }

    public record JobTerminal(long jobId, long userId, String status, String reason,
                              boolean refund) {

        public JobTerminal {
            status = status == null ? "" : status;
            reason = reason == null || reason.isBlank() ? "未提供原因" : reason;
        }

        public boolean refundable() {
            return refund;
        }
    }
}
