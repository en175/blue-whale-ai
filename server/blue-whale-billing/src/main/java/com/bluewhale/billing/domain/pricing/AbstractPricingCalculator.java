package com.bluewhale.billing.domain.pricing;

import java.util.Map;

public abstract class AbstractPricingCalculator {

    private final DiscountResolver discountResolver;

    protected AbstractPricingCalculator(DiscountResolver discountResolver) {
        this.discountResolver = discountResolver == null ? DiscountResolver.NONE : discountResolver;
    }

    public final long compute(PricingContext ctx) {
        return computeDetailed(ctx).credits();
    }

    public final Outcome computeDetailed(PricingContext ctx) {
        Usage usage = normalize(ctx);
        long units = aggregateUnits(ctx, usage);
        long mc = units * resolveBasePrice(ctx) / ctx.rule().unitDenominator();
        mc += dimPriceMc(ctx, usage);
        mc = applyMultipliers(ctx, usage, mc);
        mc = clamp(ctx, mc);

        return settle(ctx, mc);
    }

    protected long dimPriceMc(PricingContext ctx, Usage usage) {
        long mc = 0L;
        for (Map.Entry<UsageDim, CompiledRule.DimPrice> e : ctx.rule().dimPrices().entrySet()) {
            long quantity = Math.max(0L, usage.quantityOf(e.getKey()));
            long billable = e.getValue().firstFree() ? Math.max(0L, quantity - 1L) : quantity;
            mc += billable * e.getValue().unitMc();
        }
        return mc;
    }

    public final Outcome capDetailed(PricingContext ctx) {
        Long capCredits = ctx.rule().maxCredits();
        if (capCredits == null) {
            throw new IllegalArgumentException("该规则没有配上限，不能按上限计价："
                    + ctx.request().modelId() + "/" + ctx.request().taskType());
        }
        requirePriceable(ctx);
        return settle(ctx, capCredits * 1000L);
    }

    private Outcome settle(PricingContext ctx, long mc) {
        DiscountResolver.Discount discount = discountResolver.resolve(ctx);
        mc = mc * discount.factorBp() / 10_000L;

        long credits = ctx.rule().rounding().round(mc, ctx.rule().minCredits());
        return new Outcome(credits, discount);
    }

    private void requirePriceable(PricingContext ctx) {
        ctx.rule().basePrice().resolve(ctx.specs());
    }

    public record Outcome(long credits, DiscountResolver.Discount discount) {}

    protected Usage normalize(PricingContext ctx) {
        return ctx.usage();
    }

    protected long aggregateUnits(PricingContext ctx, Usage usage) {
        long units = usage.quantityOf(ctx.rule().baseUnit());
        for (var e : ctx.rule().dims().entrySet()) {
            units += usage.quantityOf(e.getKey()) * e.getValue() / 10_000L;
        }
        return units;
    }

    protected long resolveBasePrice(PricingContext ctx) {
        return ctx.rule().basePrice().resolve(ctx.specs());
    }

    protected long applyMultipliers(PricingContext ctx, Usage usage, long mc) {
        for (var e : ctx.rule().multipliers().entrySet()) {
            long value = usage.quantityOf(e.getKey());
            mc = mc * multiplierPermille(e.getKey(), value, e.getValue()) / 10_000L;
        }
        return mc;
    }

    protected long multiplierPermille(UsageDim dim, long quantity, int permillePerUnit) {
        return quantity <= 0 ? 10_000L : quantity * permillePerUnit;
    }

    protected long clamp(PricingContext ctx, long mc) {
        Long maxCredits = ctx.rule().maxCredits();
        if (maxCredits != null) {
            mc = Math.min(mc, maxCredits * 1000L);
        }
        return mc;
    }
}
