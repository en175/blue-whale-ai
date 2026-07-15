package com.blue.whale.agent.service.governance;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;

@RequiredArgsConstructor
@Service
public class GenerationAuthorizationGate {

    static final long DIRECT_LIMIT_FEN = 200L;

    private final PriceCatalog priceCatalog;
    private final CostControlProperties properties;

    public AuthorizationDecision evaluate(GenerationAuthorizationRequest request) {
        Optional<PriceQuote> quote = priceCatalog.quote(request.actionType(), request.arguments());
        if (quote.isEmpty()) {
            return new AuthorizationDecision(AuthorizationOutcome.DENIED, null, "COST_UPPER_BOUND_UNKNOWN");
        }
        PriceQuote priced = quote.get();
        if (priced.worstCaseFen() > properties.getActionHardLimitFen()) {
            return new AuthorizationDecision(AuthorizationOutcome.DENIED, priced, "QUOTA_EXCEEDED");
        }
        if (priced.worstCaseFen() <= DIRECT_LIMIT_FEN
                && !request.irreversible()) {
            return new AuthorizationDecision(AuthorizationOutcome.DIRECT, priced, null);
        }
        if (request.validatedConfirmation()) {
            return new AuthorizationDecision(
                    AuthorizationOutcome.DIRECT, priced, "VALIDATED_CONFIRMATION");
        }
        return new AuthorizationDecision(AuthorizationOutcome.INPUT_REQUIRED, priced, "INPUT_REQUIRED");
    }
}
