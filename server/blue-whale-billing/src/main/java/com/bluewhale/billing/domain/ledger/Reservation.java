package com.bluewhale.billing.domain.ledger;

import java.util.List;

public record Reservation(
        long id,
        long jobId,
        long userId,
        long reservedCredits,
        Long actualCredits,
        long receivableCredits,
        Status status,
        List<Allocation> allocations,
        int catalogVersion,
        int discountBp,
        String ruleSnapshot,
        String title,
        String releaseNote
) {

    public enum Status {

        HELD("held"),

        SETTLED("settled"),

        RELEASED("released");

        private final String key;

        Status(String key) {
            this.key = key;
        }

        public String key() {
            return key;
        }

        public static Status of(String key) {
            for (Status status : values()) {
                if (status.key.equals(key)) {
                    return status;
                }
            }
            throw new IllegalArgumentException("未知的预留状态：" + key);
        }
    }

    public boolean isPending() {
        return status == Status.HELD;
    }
}
