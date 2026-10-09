package com.bluewhale.billing.domain.pricing;

public sealed interface RoundingPolicy permits RoundingPolicy.HalfUp, RoundingPolicy.Ceil, RoundingPolicy.Floor {

    long round(long mc, long minCredits);

    record HalfUp() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, (mc + 500L) / 1000L);
        }
    }

    record Ceil() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, Math.floorDiv(mc + 999L, 1000L));
        }
    }

    record Floor() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, Math.floorDiv(mc, 1000L));
        }
    }

    static long roundHalfUpMc(long mc) {
        return (mc + 500L) / 1000L;
    }
}
