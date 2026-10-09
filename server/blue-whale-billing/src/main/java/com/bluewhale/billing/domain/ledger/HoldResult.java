package com.bluewhale.billing.domain.ledger;

public record HoldResult(long reservedCredits, int catalogVersion, boolean duplicated) {

    public static HoldResult fresh(long reservedCredits, int catalogVersion) {
        return new HoldResult(reservedCredits, catalogVersion, false);
    }

    public static HoldResult replay(long reservedCredits, int catalogVersion) {
        return new HoldResult(reservedCredits, catalogVersion, true);
    }
}
