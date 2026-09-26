package com.bluewhale.billing.pricing;

import java.util.Map;

/**
 * 计价管线骨架 —— **模板方法**（《计费逻辑详细设计》§4.6.2）。
 *
 * <p><b>所有模态共用同一流程，子类不可覆写 {@link #compute}</b>。
 * 为什么钉死顺序：计费顺序被某个模态改乱 = 算错钱，而且极难发现——
 * 用户看到的数字仍然「像那么回事」，只是算错了。
 *
 * <p>八步：
 * <ol>
 *   <li>{@link #normalize} 归一化用量（文本需减掉被单独定价的子类；媒介类 no-op）</li>
 *   <li>{@link #aggregateUnits} 等效数量 = 基准数量 + Σ(其他维度数量 × 相对倍率)</li>
 *   <li>× 基准单价 ÷ unitDenominator</li>
 *   <li>{@link #dimPriceMc} 加**绝对**的按维度加价（不乘基准单价；空 = 一行不执行）</li>
 *   <li>{@link #applyMultipliers} 整单倍率连乘</li>
 *   <li>{@link #clamp} 上下限（**在折扣之前**——封顶是对定价的封顶，不是对折后价）</li>
 *   <li>折扣</li>
 *   <li>★ **出口唯一一次舍入**，在写账本之前</li>
 * </ol>
 *
 * <p>另有一条**旁路** {@link #capDetailed}：契约量取不到时按规则上限计价。它跳过
 * ①~④（上限与用量无关），⑤~⑧ 一步不少 —— 旁路存在不是因为流程可以各写一份。
 * ⚠️ 跳过 ④ 意味着**上限冻结算不到绝对加价**，所以 {@code maxCredits} 与
 * {@code dimPrices} 不允许同时配（见 {@link CompiledRule} 的构造校验）。
 */
public abstract class AbstractPricingCalculator {

    private final DiscountResolver discountResolver;

    protected AbstractPricingCalculator(DiscountResolver discountResolver) {
        this.discountResolver = discountResolver == null ? DiscountResolver.NONE : discountResolver;
    }

    /**
     * 模板方法。**final**：骨架不可覆写，子类只实现钩子。
     *
     * @return 整数积分
     */
    public final long compute(PricingContext ctx) {
        return computeDetailed(ctx).credits();
    }

    /**
     * 同 {@link #compute}，但把命中明细一并带出（写进定价快照，供「为什么这个价」追溯）。
     *
     * <p>折扣解析**只做一次**——若让调用方另外再解析一遍取明细，会要求解析器
     * 严格确定性；一旦引入促销库存之类的时间敏感逻辑，两处就会漂移。
     *
     * @return 积分 + 命中折扣
     */
    public final Outcome computeDetailed(PricingContext ctx) {
        Usage usage = normalize(ctx);
        long units = aggregateUnits(ctx, usage);
        long mc = units * resolveBasePrice(ctx) / ctx.rule().unitDenominator();
        mc += dimPriceMc(ctx, usage);
        mc = applyMultipliers(ctx, usage, mc);
        mc = clamp(ctx, mc);

        return settle(ctx, mc);
    }

    /**
     * 按维度的**绝对**加价 —— 与 {@link #aggregateUnits} 的区别是它**不乘 basePrice**。
     *
     * <p>为什么这一步不能并进 {@code aggregateUnits}：那里产出的是「等效单位数」，
     * 之后统一乘基准单价。于是「每个单位多少钱」= 万分比 × basePrice —— **随笔单价变**。
     * 对单价分档的规则（Seedream 5.0 Pro 的输出图按像素分 0.3 / 0.6 两档），
     * 同一个「参考图每张 0.02 元」在两档下要两个不同的万分比，一个字段表达不了。
     * 绝对加价直接以 mc 计价，与 basePrice 解耦。
     *
     * <p><b>位置在基准价之后、上限之前、折扣之前</b>，三处都有理由：
     * <ul>
     *   <li>在上限之前 —— 上限是对**整单**的封顶，加价也在其内（封顶是对用户的保护，
     *       不该被加价绕过）</li>
     *   <li>在折扣之前 —— 会员折扣对全部金额一致作用，不让加价成为折扣的例外</li>
     *   <li>在舍入之前 —— {@link #settle} 的出口仍然只舍入一次</li>
     * </ul>
     *
     * <p>⚠️ {@link #capDetailed} **不走这里**（它跳过用量计算，用 {@code Usage.empty()}），
     * 所以上限冻结算不到这份加价，而结算会把它算进去 ⇒ 超出预扣记应收。
     * 因此 {@link CompiledRule} 的构造与 TS 写闸门**都禁止** {@code maxCredits} 与
     * {@code dimPrices} 同时出现。这里再兜一句：真同时出现时按加价算，宁可结算超出被记应收，
     * 也不要静默少收 —— 但那种配置根本不该存在。
     *
     * <p>空 map（绝大多数规则）= 这个循环一次都不执行 = 算术与没有这个字段时逐字相同。
     */
    protected long dimPriceMc(PricingContext ctx, Usage usage) {
        long mc = 0L;
        for (Map.Entry<UsageDim, CompiledRule.DimPrice> e : ctx.rule().dimPrices().entrySet()) {
            // 负数量一律当 0：worker 今天报不出负数，但 `multiplierPermille` 对同样的情形
            // 也做了防御（见那里「quantity <= 0」）。不夹这一下的后果是**减钱**，
            // 而且负到下限之后被 minCredits 兜住 —— 静默接近免费。
            long quantity = Math.max(0L, usage.quantityOf(e.getKey()));
            // firstFree：官方的「首张参考图免费」就是这一步（线性公式只能给 n，给不了 n-1）
            long billable = e.getValue().firstFree() ? Math.max(0L, quantity - 1L) : quantity;
            mc += billable * e.getValue().unitMc();
        }
        return mc;
    }

    /**
     * 按**规则上限**计价 —— 「契约量取不到」时的兜底（见 {@link PricingEngine#computeAtCap}）。
     *
     * <p>只跳过前四步：上限是规则里配的一个常数，**与用量、基准单价、倍率都无关**。
     * 封顶 → 折扣 → 舍入仍走 {@link #settle}，与常规计价同一条通道 ——
     * 折扣解析只做一次、舍入只做一次这两条不变式不因为兜底而破。
     *
     * <p>规格组合**仍须可计价**（见 {@link #requirePriceable}）：上限算得出来，不代表
     * 结算时算得出来。
     *
     * @throws IllegalArgumentException 该规则没配上限——没有上限可依，调用方须先判
     * @throws BasePriceResolver.UnpriceableSpecException 该规格组合没配价（与常规计价同一立场）
     */
    public final Outcome capDetailed(PricingContext ctx) {
        Long capCredits = ctx.rule().maxCredits();
        if (capCredits == null) {
            throw new IllegalArgumentException("该规则没有配上限，不能按上限计价："
                    + ctx.request().modelId() + "/" + ctx.request().taskType());
        }
        requirePriceable(ctx);
        return settle(ctx, capCredits * 1000L);
    }

    /**
     * 收口：折扣 → 舍入，出口**唯一一次**舍入。
     *
     * @param mc 封顶之后的金额（mc），1 积分 = 1000 mc
     */
    private Outcome settle(PricingContext ctx, long mc) {
        DiscountResolver.Discount discount = discountResolver.resolve(ctx);
        mc = mc * discount.factorBp() / 10_000L;

        long credits = ctx.rule().rounding().round(mc, ctx.rule().minCredits());
        return new Outcome(credits, discount);
    }

    /**
     * 该规格组合的基准单价**必须查得到** —— 返回值不用，只为当场暴露漏配。
     *
     * <p>为什么上限计价也要查一次价：上限是常数，与单价无关，但**结算会按真实用量
     * 重新计价**。规格组合查不到价 ⇒ 结算同样算不出价 ⇒ 那笔预扣结不掉、用户的钱一直冻着。
     * 所以这里让 {@link BasePriceResolver.UnpriceableSpecException} 照常抛出：
     * 兜底只对「契约量取不到」开一个口子，不对「漏配价」开口子。
     */
    private void requirePriceable(PricingContext ctx) {
        ctx.rule().basePrice().resolve(ctx.specs());
    }

    /**
     * @param credits  整数积分——用户看到的与账本记的同一个数
     * @param discount 命中的折扣（含明细）
     */
    public record Outcome(long credits, DiscountResolver.Discount discount) {}

    /**
     * ① 归一化。**默认 no-op**（媒介类：图片/视频/音频/按次的计量维度本来互斥）。
     *
     * <p>文本 / 多模态要覆写为「减掉被单独定价的子类」——上游 usage 的分类是重叠的
     * （OpenAI 的 prompt_tokens 已含 cached），不归一化会**重复计费**（§2.5.4）。
     */
    protected Usage normalize(PricingContext ctx) {
        return ctx.usage();
    }

    /**
     * ② 等效数量。
     *
     * <pre>
     *   baseUnit 的数量 + Σ( dims 各维度的数量 × 相对倍率 / 10000 )
     * </pre>
     */
    protected long aggregateUnits(PricingContext ctx, Usage usage) {
        long units = usage.quantityOf(ctx.rule().baseUnit());
        for (var e : ctx.rule().dims().entrySet()) {
            units += usage.quantityOf(e.getKey()) * e.getValue() / 10_000L;
        }
        return units;
    }

    /** ③ 基准单价（常数或按轴查表）。查不到会抛 {@link BasePriceResolver.UnpriceableSpecException}。 */
    protected long resolveBasePrice(PricingContext ctx) {
        return ctx.rule().basePrice().resolve(ctx.specs());
    }

    /** ④ 整单倍率连乘。 */
    protected long applyMultipliers(PricingContext ctx, Usage usage, long mc) {
        for (var e : ctx.rule().multipliers().entrySet()) {
            long value = usage.quantityOf(e.getKey());
            mc = mc * multiplierPermille(e.getKey(), value, e.getValue()) / 10_000L;
        }
        return mc;
    }

    /**
     * 单条倍率的取值。默认「线性」：**每单位倍率 × 该维度数量**。
     *
     * <p>例：参考素材每单位 ×1.2（{@code permillePerUnit = 12000}），2 个参考 → 24000 = ×2.4。
     * 业务上「1 个参考不加价、2 个起加价」用 0 数量自然得到 ×1.0，无需特判。
     *
     * <p>⚠️ <b>单位是万分比</b>（12000 = 1.2×），与 {@code dims} 一致。
     * 注意《计费逻辑详细设计》§2.5.1 的 JSON 示例写的是 {@code "referenceCount": 1200}，
     * 那是**千分比**写法，与 §2.5.2「倍率 = 万分比整数」自相矛盾——**以实现为准，文档待修**。
     *
     * <p>需要阈值 / 枚举语义的模型，覆写本方法即可——**不动骨架**。
     */
    protected long multiplierPermille(UsageDim dim, long quantity, int permillePerUnit) {
        return quantity <= 0 ? 10_000L : quantity * permillePerUnit;
    }

    /** ⑤ 上下限。**在折扣之前**：封顶是对定价的封顶。下限在最后一步还会兜一次。 */
    protected long clamp(PricingContext ctx, long mc) {
        Long maxCredits = ctx.rule().maxCredits();
        if (maxCredits != null) {
            mc = Math.min(mc, maxCredits * 1000L);
        }
        return mc;
    }
}
