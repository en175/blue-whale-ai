package com.bluewhale.billing.domain.pricing;

public final class MediaPricingCalculator extends AbstractPricingCalculator {

    public MediaPricingCalculator(DiscountResolver discountResolver) {
        super(discountResolver);
    }

    public MediaPricingCalculator() {
        this(DiscountResolver.NONE);
    }
}
