package com.blue.whale.agent.service.governance;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DefaultPriceCatalogTest {

    @Test
    void videoQuoteUsesCanonicalProviderIdentity() {
        DefaultPriceCatalog catalog = new DefaultPriceCatalog(new CostControlProperties());

        PriceQuote quote = catalog.quote(
                "generate_video", Map.of("expected_output_count", 1)).orElseThrow();

        assertThat(quote.provider()).isEqualTo("seedance");
    }

    @Test
    void quoteRetainsSourcePricingEvidence() {
        DefaultPriceCatalog catalog = new DefaultPriceCatalog(new CostControlProperties());

        PriceQuote quote = catalog.quote(
                "generate_image", Map.of("expected_output_count", 1)).orElseThrow();

        assertThat(quote.originalCurrency()).isEqualTo("CNY");
        assertThat(quote.billingUnit()).isEqualTo("output");
        assertThat(quote.effectiveAt()).isEqualTo("2026-07-14T00:00+08:00");
        assertThat(quote.sourceVersion()).isEqualTo("manual-price-v1");
    }
}
