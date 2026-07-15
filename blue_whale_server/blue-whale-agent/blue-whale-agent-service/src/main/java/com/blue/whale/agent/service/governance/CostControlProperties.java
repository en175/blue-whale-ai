package com.blue.whale.agent.service.governance;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "blue-whale.cost-control")
public class CostControlProperties {
    private String ruleVersion = "cost-rules-v1";
    private String priceCatalogVersion = "price-catalog-v1";
    private String priceOriginalCurrency = "CNY";
    private String priceBillingUnit = "output";
    private String priceEffectiveAt = "2026-07-14T00:00+08:00";
    private String priceSourceVersion = "manual-price-v1";
    private String exchangeRateVersion = "cny-rate-v1";
    private String modelPolicyVersion = "model-policy-v1";
    private long actionHardLimitFen = 2_000L;
    private long projectDailyLimitFen = 5_000L;
    private long userDailyLimitFen = 10_000L;
    private long userMonthlyLimitFen = 50_000L;
    private long providerDailyLimitFen = 100_000L;
    private long globalDailyLimitFen = 1_000_000L;
    private long imageReservationFen = 25L;
    private long videoReservationFen = 50L;
    private int auditRetentionDays = 365;
}
