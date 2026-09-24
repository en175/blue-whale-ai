package com.bluewhale.billing.pricing;

import java.util.LinkedHashMap;
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

    /**
     * 从**线格式**的字符串键构造 —— MQ 的 JSON 与 gRPC 的 proto 都走这里。
     *
     * <p>两种线格式（{@code events.proto} 的 JSON 载荷、{@code usage.proto} 的 proto 消息）
     * 各自把维度键编码成字符串，但落到领域对象这一步是同一个动作。
     * 放在这里是为了让「键怎么解释」只有一处定义——两份复制品迟早在
     * 某个维度上分叉，而那种分叉是少算一笔钱。
     *
     * @throws UsageDim.UnknownUsageDimException 出现封闭枚举之外的键。
     *         **拒绝而不是忽略**：忽略一个维度就是少收一笔钱，且没有任何信号
     */
    public static Usage ofKeys(String modelId, String taskType, Map<String, Long> quantitiesByKey) {
        if (quantitiesByKey == null || quantitiesByKey.isEmpty()) {
            return new Usage(modelId, taskType, Map.of());
        }
        Map<UsageDim, Long> byDim = new LinkedHashMap<>();
        quantitiesByKey.forEach((key, value) -> byDim.put(UsageDim.of(key), value));
        return new Usage(modelId, taskType, byDim);
    }

    public static Usage empty() {
        return new Usage(null, null, Map.of());
    }

    public long quantityOf(UsageDim dim) {
        return dim.quantityOf(quantities);
    }
}
