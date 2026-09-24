package com.bluewhale.billing.pricing;

/**
 * 计价管线骨架 —— **模板方法**（《计费逻辑详细设计》§4.6.2）。
 *
 * <p><b>所有模态共用同一流程，子类不可覆写 {@link #compute}</b>。
 * 为什么钉死顺序：计费顺序被某个模态改乱 = 算错钱，而且极难发现——
 * 用户看到的数字仍然「像那么回事」，只是算错了。
 *
 * <p>七步：
 * <ol>
 *   <li>{@link #normalize} 归一化用量（文本需减掉被单独定价的子类；媒介类 no-op）</li>
 *   <li>{@link #aggregateUnits} 等效数量 = 基准数量 + Σ(其他维度数量 × 相对倍率)</li>
 *   <li>× 基准单价 ÷ unitDenominator</li>
 *   <li>{@link #applyMultipliers} 整单倍率连乘</li>
 *   <li>{@link #clamp} 上下限（**在折扣之前**——封顶是对定价的封顶，不是对折后价）</li>
 *   <li>折扣</li>
 *   <li>★ **出口唯一一次舍入**，在写账本之前</li>
 * </ol>
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
        mc = applyMultipliers(ctx, usage, mc);
        mc = clamp(ctx, mc);

        DiscountResolver.Discount discount = discountResolver.resolve(ctx);
        mc = mc * discount.factorBp() / 10_000L;

        long credits = ctx.rule().rounding().round(mc, ctx.rule().minCredits());
        return new Outcome(credits, discount);
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
