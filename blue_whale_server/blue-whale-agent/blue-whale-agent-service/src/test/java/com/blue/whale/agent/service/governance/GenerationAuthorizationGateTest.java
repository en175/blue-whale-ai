package com.blue.whale.agent.service.governance;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class GenerationAuthorizationGateTest {

    @Test
    void explicitActionWithinTwoYuanIsAuthorizedDirectly() {
        PriceCatalog catalog = (actionType, arguments) -> Optional.of(new PriceQuote(
                200L,
                "image-provider",
                "price-2026-07",
                "cny-2026-07",
                "model-policy-v1"));
        GenerationAuthorizationGate gate = new GenerationAuthorizationGate(
                catalog, new CostControlProperties());

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "generate_image",
                Map.of("prompt", "a whale"),
                false,
                false));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.DIRECT);
        assertThat(decision.quote().worstCaseFen()).isEqualTo(200L);
    }

    @Test
    void actionAboveTwoYuanRequiresNaturalLanguageConfirmation() {
        GenerationAuthorizationGate gate = gateFor(201L);

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "generate_image", Map.of("prompt", "a whale"), false, false));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.INPUT_REQUIRED);
        assertThat(decision.reasonCode()).isEqualTo("INPUT_REQUIRED");
    }

    @Test
    void validatedConfirmationCannotBypassTwentyYuanHardLimit() {
        GenerationAuthorizationGate gate = gateFor(2_001L);

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "generate_image", Map.of("prompt", "a whale"), false, true));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.DENIED);
        assertThat(decision.reasonCode()).isEqualTo("QUOTA_EXCEEDED");
    }

    @Test
    void configuredActionHardLimitIsUsedByAuthorizationGate() {
        CostControlProperties properties = new CostControlProperties();
        properties.setActionHardLimitFen(100L);
        properties.setImageReservationFen(101L);
        GenerationAuthorizationGate gate = new GenerationAuthorizationGate(
                new DefaultPriceCatalog(properties), properties);

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "generate_image", Map.of("expected_output_count", 1), false, true));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.DENIED);
        assertThat(decision.reasonCode()).isEqualTo("QUOTA_EXCEEDED");
    }

    @Test
    void unknownWorstCaseCostFailsClosed() {
        GenerationAuthorizationGate gate = new GenerationAuthorizationGate(
                (actionType, arguments) -> Optional.empty(), new CostControlProperties());

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "unknown", Map.of(), false, false));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.DENIED);
        assertThat(decision.reasonCode()).isEqualTo("COST_UPPER_BOUND_UNKNOWN");
    }

    @Test
    void invalidOutputCountCannotFallBackToSingleOutputPricing() {
        CostControlProperties properties = new CostControlProperties();
        GenerationAuthorizationGate gate = new GenerationAuthorizationGate(
                new DefaultPriceCatalog(properties), properties);

        AuthorizationDecision decision = gate.evaluate(new GenerationAuthorizationRequest(
                "generate_image", Map.of("expected_output_count", 1_000), false, false));

        assertThat(decision.outcome()).isEqualTo(AuthorizationOutcome.DENIED);
        assertThat(decision.reasonCode()).isEqualTo("COST_UPPER_BOUND_UNKNOWN");
    }

    private GenerationAuthorizationGate gateFor(long amountFen) {
        return new GenerationAuthorizationGate((actionType, arguments) -> Optional.of(new PriceQuote(
                amountFen, "image-provider", "price-2026-07", "cny-2026-07", "model-policy-v1")),
                new CostControlProperties());
    }
}
