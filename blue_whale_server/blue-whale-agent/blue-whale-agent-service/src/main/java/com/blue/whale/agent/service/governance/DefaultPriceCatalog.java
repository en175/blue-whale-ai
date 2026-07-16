package com.blue.whale.agent.service.governance;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

@Component
@RequiredArgsConstructor
public class DefaultPriceCatalog implements PriceCatalog {

    private final CostControlProperties properties;

    @Override
    public Optional<PriceQuote> quote(String actionType, Map<String, Object> arguments) {
        OptionalInt outputCount = outputCount(arguments);
        if (outputCount.isEmpty()) {
            return Optional.empty();
        }
        if ("generate_image".equals(actionType)) {
            return Optional.of(new PriceQuote(
                    Math.multiplyExact(properties.getImageReservationFen(), outputCount.getAsInt()),
                    provider(arguments, "image-sync"),
                    properties.getPriceCatalogVersion(),
                    properties.getExchangeRateVersion(),
                    properties.getModelPolicyVersion(),
                    properties.getPriceOriginalCurrency(),
                    properties.getPriceBillingUnit(),
                    properties.getPriceEffectiveAt(),
                    properties.getPriceSourceVersion()));
        }
        if ("generate_video".equals(actionType)) {
            return Optional.of(new PriceQuote(
                    Math.multiplyExact(properties.getVideoReservationFen(), outputCount.getAsInt()),
                    provider(arguments, "seedance"),
                    properties.getPriceCatalogVersion(),
                    properties.getExchangeRateVersion(),
                    properties.getModelPolicyVersion(),
                    properties.getPriceOriginalCurrency(),
                    properties.getPriceBillingUnit(),
                    properties.getPriceEffectiveAt(),
                    properties.getPriceSourceVersion()));
        }
        return Optional.empty();
    }

    private OptionalInt outputCount(Map<String, Object> arguments) {
        if (arguments == null || !arguments.containsKey("expected_output_count")) {
            return OptionalInt.of(1);
        }
        Object raw = arguments.get("expected_output_count");
        if (raw instanceof Number number) {
            int count = number.intValue();
            if (count > 0 && count <= 4 && number.doubleValue() == (double) count) {
                return OptionalInt.of(count);
            }
        }
        return OptionalInt.empty();
    }

    private String provider(Map<String, Object> arguments, String fallback) {
        Object configured = arguments == null ? null : arguments.get("_cost_provider");
        return configured instanceof String value && !value.isBlank() ? value : fallback;
    }
}
