package com.bluewhale.billing.pricing;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 用量的领域类型 —— **有两个来源，别混**：
 *
 * <ul>
 *   <li><b>真实用量</b>（{@link #ofKeys}）：worker 跑完之后上报的原始量。结算按它计价。</li>
 *   <li><b>契约用量</b>（{@link #contractFrom}）：提交/预览时刻从规格快照推出来的
 *       「这次最多会产出多少」。预扣按它定上限。</li>
 * </ul>
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

    /**
     * 契约用量 —— 从**规格快照**推出来的「这次最多会产出多少」。
     *
     * <p>提交（预扣）与预览（报价）都还没有真实用量：worker 还没跑。此刻能知道的量
     * 只有契约量，而它已经在 job 的规格快照里了（张数 {@code expected_output_count}、
     * 时长 {@code duration}），随 {@code specs} 一起送到 billing。
     *
     * <h2>为什么不能像以前那样用 {@link #empty()} 计价</h2>
     *
     * {@code quantityOf} 对取不到的维度返回 0，于是基准维度的数量恒为 0：
     * 只有 {@code constant:1}（按次）的规则不受影响（它恒返回 1），而**按槽 / 按秒计价的
     * 规则会一路算到 {@code minCredits}**——预扣只冻了下限，结算侧又把消耗截到预扣额
     * （{@code CreditService#settle}），差额**平台自己吃**，账面上没有任何异常。
     *
     * <h2>取不到基准量就拒绝</h2>
     *
     * 基准维度没有契约量来源（或这次请求的规格里没有），**拒绝比冻下限好**：冻下限是
     * 静默少收，而拒绝会当场暴露成一次提交失败 + 一条「补配置」的信号。这与
     * {@code BasePriceResolver} 查不到规格就抛 {@code UnpriceableSpecException} 同一个立场。
     *
     * @param rule  该 (model, taskType) 的规则 —— 它决定哪个维度是基准
     * @param specs job 规格快照（标量，键已小写）
     * @throws ContractQuantityUnavailableException 基准维度取不到契约量
     */
    public static Usage contractFrom(CompiledRule rule, Map<String, String> specs) {
        Map<UsageDim, Long> fromSpecs = new LinkedHashMap<>();
        for (UsageDim dim : UsageDim.values()) {
            Long quantity = contractQuantity(dim, specs);
            if (quantity != null) {
                fromSpecs.put(dim, quantity);
            }
        }
        // constant:1 不在 specs 里，它由 quantityOf 自己给 1 —— 不参与这条校验
        if (rule.baseUnit() != UsageDim.CONSTANT_ONE && !fromSpecs.containsKey(rule.baseUnit())) {
            throw new ContractQuantityUnavailableException(rule.baseUnit(), specs);
        }
        return new Usage(null, null, fromSpecs);
    }

    /**
     * 某个维度的契约量；{@code null} = 这次请求给不出。
     *
     * <p>负数也算「给不出」：{@code duration=-1} 是 edit/prolong 的**自动时长**，
     * 真实时长提交时未知——当成 -1 个秒数会把基准量算成负数，最后仍然落到下限。
     */
    private static Long contractQuantity(UsageDim dim, Map<String, String> specs) {
        String specKey = dim.contractSpecKey();
        String raw = specKey == null ? null : specs.get(specKey);
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            // BigDecimal.longValueExact：'5.0' 收（就是 5 秒），'5.5' 拒。
            // **不截断**：截断成 5 就是少冻钱，而且没有任何信号。
            long value = new BigDecimal(raw.trim()).longValueExact();
            return value < 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    /** 规则的基准维度在提交时刻取不到契约量——预扣算不出上限。这是**配置/传参对不上**，不是用户错误。 */
    public static class ContractQuantityUnavailableException extends RuntimeException {

        /**
         * @param baseUnit 取不到契约量的那个基准维度
         * @param specs    这次请求带的规格键（报出来供运维对照缺了哪个）
         */
        public ContractQuantityUnavailableException(UsageDim baseUnit, Map<String, String> specs) {
            super("预扣算不出上限：" + baseUnit.key() + " 是本规则的基准维度，而"
                    + (baseUnit.contractSpecKey() == null
                            ? "它在提交时刻没有契约量来源"
                            : "请求的规格里没有可用的 " + baseUnit.contractSpecKey())
                    + "（本次规格键：" + specs.keySet() + "）"
                    + " —— 按 0 计价只会冻到下限，差额由平台承担，故拒绝");
            this.baseUnit = baseUnit;
        }

        /** 取不到契约量的那个基准维度。 */
        private final UsageDim baseUnit;

        public UsageDim baseUnit() {
            return baseUnit;
        }
    }

    public long quantityOf(UsageDim dim) {
        return dim.quantityOf(quantities);
    }
}
