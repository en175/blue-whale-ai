package com.bluewhale.billing.adapter.inbound.mq;

import java.util.List;
import java.util.Map;

public final class JobEventPayload {

    private JobEventPayload() {
    }

    public record JobCompleted(
            long jobId,
            long userId,
            String status,
            int catalogVersion,
            int succeededSlots,
            List<UsageLine> usage
    ) {
        public JobCompleted {
            usage = usage == null ? List.of() : List.copyOf(usage);
        }
    }

    public record UsageLine(
            String modelId,
            String taskType,
            Map<String, Long> quantities,
            Map<String, String> specs
    ) {
        public UsageLine {
            quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
            specs = specs == null ? Map.of() : Map.copyOf(specs);
        }
    }

    public record JobFailed(long jobId, long userId, String reason) {

        public JobFailed {
            reason = reason == null || reason.isBlank() ? "未提供原因" : reason;
        }
    }
}
