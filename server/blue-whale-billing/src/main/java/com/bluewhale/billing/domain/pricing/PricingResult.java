package com.bluewhale.billing.domain.pricing;

import java.util.List;

public record PricingResult(
        long credits,
        DiscountResolver.Discount discount,
        String modelId,
        String taskType
) {

    public PricingResult {
        if (credits < 0) {
            throw new IllegalArgumentException("积分不能为负：" + credits);
        }
        if (discount == null) {
            discount = DiscountResolver.Discount.none();
        }
    }

    public boolean isDiscounted() {
        return discount.isDiscounted();
    }

    public List<DiscountResolver.AppliedDiscount> appliedDiscounts() {
        return discount.applied();
    }
}
