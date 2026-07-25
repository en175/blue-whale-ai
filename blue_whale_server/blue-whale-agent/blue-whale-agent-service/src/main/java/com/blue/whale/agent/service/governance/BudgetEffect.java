package com.blue.whale.agent.service.governance;

public enum BudgetEffect {
    NONE("none"),
    RESERVED("reserved"),
    RESERVATION_RELEASED("reservation_released"),
    ACTUAL_SETTLED("actual_settled"),
    PENDING_RECONCILIATION("pending_reconciliation");

    private final String wireValue;

    BudgetEffect(String wireValue) {
        this.wireValue = wireValue;
    }

    public String wireValue() {
        return wireValue;
    }
}
