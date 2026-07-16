package com.blue.whale.agent.service.governance;

public enum CostReservationStatus {
    ACTIVE,
    SETTLED,
    RELEASED,
    PENDING_RECONCILIATION;

    public boolean canTransitionTo(CostReservationStatus target) {
        if (this == target) {
            return true;
        }
        return switch (this) {
            case ACTIVE -> target == SETTLED
                    || target == RELEASED
                    || target == PENDING_RECONCILIATION;
            case PENDING_RECONCILIATION -> target == SETTLED || target == RELEASED;
            case SETTLED, RELEASED -> false;
        };
    }

    public BudgetEffect budgetEffect() {
        return switch (this) {
            case ACTIVE -> BudgetEffect.RESERVED;
            case SETTLED -> BudgetEffect.ACTUAL_SETTLED;
            case RELEASED -> BudgetEffect.RESERVATION_RELEASED;
            case PENDING_RECONCILIATION -> BudgetEffect.PENDING_RECONCILIATION;
        };
    }
}
