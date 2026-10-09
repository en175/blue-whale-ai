package com.bluewhale.billing.domain.pricing;

import java.util.List;

@FunctionalInterface
public interface DiscountResolver {

    DiscountResolver NONE = ctx -> Discount.none();

    static DiscountResolver frozen(int factorBp) {
        return ctx -> new Discount(factorBp,
                List.of(new AppliedDiscount("frozen", 0L, null, factorBp)));
    }

    Discount resolve(PricingContext ctx);

    default long apply(PricingContext ctx, long mc) {
        return mc * resolve(ctx).factorBp() / 10_000L;
    }

    record Discount(int factorBp, List<AppliedDiscount> applied) {

        public Discount {
            applied = applied == null ? List.of() : List.copyOf(applied);
        }

        private static final Discount NONE = new Discount(10_000, List.of());

        public static Discount none() {
            return NONE;
        }

        public boolean isDiscounted() {
            return factorBp < 10_000;
        }
    }

    record AppliedDiscount(String source, long id, String code, int factorBp) {

        public static AppliedDiscount member(long id, int factorBp) {
            return new AppliedDiscount("member", id, null, factorBp);
        }

        public static AppliedDiscount promotion(long id, String code, int factorBp) {
            return new AppliedDiscount("promotion", id, code, factorBp);
        }
    }
}
