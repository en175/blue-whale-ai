package com.blue.whale.agent.service.governance;

public record CostReservationCommand(
        Long userId,
        Long projectId,
        Long generationJobId,
        String actionIdentity,
        String actionType,
        PriceQuote quote) {
}
