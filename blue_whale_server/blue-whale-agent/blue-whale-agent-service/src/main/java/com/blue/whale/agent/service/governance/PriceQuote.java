package com.blue.whale.agent.service.governance;

public record PriceQuote(
        long worstCaseFen,
        String provider,
        String priceCatalogVersion,
        String exchangeRateVersion,
        String modelPolicyVersion,
        String originalCurrency,
        String billingUnit,
        String effectiveAt,
        String sourceVersion) {

    public PriceQuote(
            long worstCaseFen,
            String provider,
            String priceCatalogVersion,
            String exchangeRateVersion,
            String modelPolicyVersion) {
        this(worstCaseFen, provider, priceCatalogVersion, exchangeRateVersion, modelPolicyVersion,
                null, null, null, null);
    }
}
