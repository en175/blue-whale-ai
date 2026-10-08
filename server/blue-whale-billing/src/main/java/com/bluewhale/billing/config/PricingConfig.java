package com.bluewhale.billing.config;

import com.bluewhale.billing.domain.pricing.AbstractPricingCalculator;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PricingConfig {

    @Bean
    public AbstractPricingCalculator pricingCalculator(DiscountResolver discounts) {
        return new MediaPricingCalculator(discounts);
    }
}
