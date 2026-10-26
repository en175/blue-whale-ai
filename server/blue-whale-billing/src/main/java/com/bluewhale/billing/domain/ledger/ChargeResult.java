package com.bluewhale.billing.domain.ledger;

public record ChargeResult(long chargedCredits, int catalogVersion, boolean duplicated) {

    public static ChargeResult fresh(long chargedCredits, int catalogVersion) {
        return new ChargeResult(chargedCredits, catalogVersion, false);
    }

    public static ChargeResult replay(long chargedCredits, int catalogVersion) {
        return new ChargeResult(chargedCredits, catalogVersion, true);
    }
}
