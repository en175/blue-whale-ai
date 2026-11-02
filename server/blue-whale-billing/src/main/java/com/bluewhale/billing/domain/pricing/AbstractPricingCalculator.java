package com.bluewhale.billing.domain.pricing;

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
        mc = clamp(ctx, mc);

        return settle(ctx, mc);
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
        units += ctx.rule().quantityOffset();
        long step = ctx.rule().quantityStep();
        if (step > 1) {
            units = ((units + step - 1) / step) * step;
        }
        for (var e : ctx.rule().dims().entrySet()) {
            units += usage.quantityOf(e.getKey()) * e.getValue() / 10_000L;
        }
        return units;
    }

    protected long resolveBasePrice(PricingContext ctx) {
        return ctx.rule().basePrice().resolve(ctx.specs());
    }

    protected long clamp(PricingContext ctx, long mc) {
        Long maxCredits = ctx.rule().maxCredits();
        if (maxCredits != null) {
            mc = Math.min(mc, maxCredits * 1000L);
        }
        return mc;
    }
}
