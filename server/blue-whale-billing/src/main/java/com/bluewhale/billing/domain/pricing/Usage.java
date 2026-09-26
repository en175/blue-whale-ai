package com.bluewhale.billing.domain.pricing;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
     * <p>本方法只**如实报告**「这次取不到」，不自己兜底：调用方
     * （{@code BillingApplicationService}）在规则配了 {@code maxCredits}、且该维度登记了
     * 契约量来源时，会改用**上限冻结**（{@code duration=-1} 的自动时长就是这种情形——
     * 真实量提交时未知，但这类任务不该变成 400）；其余情形这条异常就是最终结果。
     *
     * @param rule  该 (model, taskType) 的规则 —— 它决定哪个维度是基准
     * @param specs job 规格快照（标量，键已小写）
     * @throws ContractQuantityUnavailableException 基准维度取不到契约量
     */
    public static Usage contractFrom(CompiledRule rule, Map<String, String> specs) {
        Map<UsageDim, Long> fromSpecs = new LinkedHashMap<>();
        // 估算维度（视频 token）留到直读都取完之后再算：它的公式要吃「时长」（SECONDS）
        // 与「片段数」（SUCCEEDED_SLOTS）这两个契约量，而那两个都是直读来的——
        // 依赖枚举声明顺序是脆的，分两趟是把它变成结构性的。
        List<UsageDim> estimatedDims = new ArrayList<>();
        for (UsageDim dim : UsageDim.values()) {
            if (dim.contractSource() instanceof ContractSource.Estimated) {
                estimatedDims.add(dim);
                continue;
            }
            Long quantity = contractQuantity(dim, specs);
            if (quantity != null) {
                fromSpecs.put(dim, quantity);
            }
        }
        for (UsageDim dim : estimatedDims) {
            Long quantity = estimatedQuantity(dim, rule, specs, fromSpecs);
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
        ContractSource source = dim.contractSource();
        if (!(source instanceof ContractSource.SpecKey specKey)) {
            return null;
        }
        String raw = specs.get(specKey.key());
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

    /**
     * 估算维度的契约量 —— 从**规则**登记的估算参数与已直读到的其他契约量推出来。
     *
     * @param direct 本趟之前已直读到的契约量（按槽数、时长）——估算公式的输入
     * @return 估算值；{@code null} = 这次推不出（档位+比例没配、或时长未知）
     */
    private static Long estimatedQuantity(UsageDim dim, CompiledRule rule,
                                          Map<String, String> specs, Map<UsageDim, Long> direct) {
        return switch (dim) {
            // 视频 token：官方公式 ≈ 宽 × 高 × 帧率 × 时长 ÷ divisor（× 片段数）。
            // 时长取 SECONDS 的契约量——**取不到就不估**（duration=-1 的自动时长真实值未知，
            // 用 0 兜等于把 token 估成 0 → 预扣冻下限 → 差额平台吃，且账面无信号）。
            case COMPLETION_TOKENS -> rule.tokenEstimator() == null
                    ? null
                    : rule.tokenEstimator().estimateVideoTokens(
                            specs,
                            direct.get(UsageDim.SECONDS),
                            direct.getOrDefault(UsageDim.SUCCEEDED_SLOTS, 1L));
            // 登记了「估算」却没人实现 = 漏写代码，不是取不到。当场炸比按 0 冻钱强。
            default -> throw new IllegalStateException(
                    "维度 " + dim.key() + " 登记为估算来源，但 estimatedQuantity 没有实现它");
        };
    }

    /**
     * 规则的基准维度在提交时刻取不到契约量——按契约量算不出预扣额。
     *
     * <p>不一定是用户错误：{@code duration=-1}（自动时长）是**正常的业务输入**，
     * 所以调用方在规则配了上限时会改用上限冻结；这条异常冒到调用方时，
     * 要么该维度压根没有契约量来源，要么规则没配上限（见 {@code BillingApplicationService}）。
     */
    public static class ContractQuantityUnavailableException extends RuntimeException {

        /**
         * @param baseUnit 取不到契约量的那个基准维度
         * @param specs    这次请求带的规格键（报出来供运维对照缺了哪个）
         */
        public ContractQuantityUnavailableException(UsageDim baseUnit, Map<String, String> specs) {
            super("预扣算不出上限：" + baseUnit.key() + " 是本规则的基准维度，而"
                    + (baseUnit.contractSource() == null
                            ? "它在提交时刻没有契约量来源"
                            : "它在提交时刻的契约量这次取不到"
                                    + "（" + describeSource(baseUnit.contractSource()) + "）")
                    + "（本次规格键：" + specs.keySet() + "）"
                    + " —— 按 0 计价只会冻到下限，差额由平台承担，故拒绝");
            this.baseUnit = baseUnit;
        }

        private static String describeSource(ContractSource source) {
            return switch (source) {
                case ContractSource.SpecKey specKey -> "读规格键 " + specKey.key();
                case ContractSource.Estimated ignored -> "按规则的 tokenEstimate 估算";
            };
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
