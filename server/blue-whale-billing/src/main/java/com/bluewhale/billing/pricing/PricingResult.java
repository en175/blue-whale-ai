package com.bluewhale.billing.pricing;

import java.util.List;

/**
 * 计价结果。
 *
 * @param credits     **整数积分**——用户看到的与账本记的是同一个数（§1.1）
 * @param discount    命中的折扣（含明细），写进定价快照供追溯
 * @param modelId     回显，便于调用方组装流水文案
 * @param taskType    回显
 */
public record PricingResult(
        long credits,
        DiscountResolver.Discount discount,
        String modelId,
        String taskType
) {

    public PricingResult {
        if (credits < 0) {
            // 反向金额在计费里没有语义——出现即是 bug，早失败早发现
            throw new IllegalArgumentException("积分不能为负：" + credits);
        }
        if (discount == null) {
            discount = DiscountResolver.Discount.none();
        }
    }

    public boolean isDiscounted() {
        return discount.isDiscounted();
    }

    /** 命中明细——「为什么这个价」的答案。 */
    public List<DiscountResolver.AppliedDiscount> appliedDiscounts() {
        return discount.applied();
    }
}
