package com.blue.whale.agent.service.governance;

public record CostReservationSnapshot(
        Long id,
        Long generationJobId,
        CostReservationStatus status,
        BudgetEffect budgetEffect,
        long reservedAmountFen,
        Long actualAmountFen,
        String priceCatalogVersion,
        String exchangeRateVersion,
        String modelPolicyVersion,
        String costRuleVersion) {
}
