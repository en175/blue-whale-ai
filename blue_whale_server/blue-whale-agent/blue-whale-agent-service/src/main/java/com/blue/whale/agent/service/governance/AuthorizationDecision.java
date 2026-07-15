package com.blue.whale.agent.service.governance;

public record AuthorizationDecision(
        AuthorizationOutcome outcome,
        PriceQuote quote,
        String reasonCode) {
}
