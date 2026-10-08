package com.bluewhale.billing.domain.ledger;

public class InsufficientCreditsException extends RuntimeException {

    private final long available;
    private final long required;

    public InsufficientCreditsException(long available, long required) {
        super("积分不足：可用 " + available + "，需要 " + required + "，还差 " + (required - available));
        this.available = available;
        this.required = required;
    }

    public long available() {
        return available;
    }

    public long required() {
        return required;
    }
}
