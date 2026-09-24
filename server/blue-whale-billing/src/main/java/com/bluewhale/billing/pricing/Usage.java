package com.bluewhale.billing.pricing;

import java.util.Map;

/**
 * 用量上报（领域类型）。
 *
 * <p>worker **只上报原始量，不上报积分**——价格是 billing 的事。
 *
 * @param quantities 维度 → 数量。**缺维度 = 0**（worker 可能不上报某个维度，
 *                   例如无参考素材时不上报 {@code referenceCount}），是正常情况。
 */
public record Usage(
        String modelId,
        String taskType,
        Map<UsageDim, Long> quantities
) {

    public Usage {
        quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
    }

    public static Usage of(UsageDim dim, long value) {
        return new Usage(null, null, Map.of(dim, value));
    }

    public static Usage empty() {
        return new Usage(null, null, Map.of());
    }

    public long quantityOf(UsageDim dim) {
        return dim.quantityOf(quantities);
    }
}
