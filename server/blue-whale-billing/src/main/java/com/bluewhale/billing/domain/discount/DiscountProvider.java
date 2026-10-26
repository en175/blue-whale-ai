package com.bluewhale.billing.domain.discount;

import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingContext;

import java.util.List;
import java.util.Optional;

public interface DiscountProvider {

    Optional<DiscountResolver.AppliedDiscount> resolve(PricingContext ctx);

    String source();

    interface Candidate {
        long id();

        String code();

        int discountBp();

        List<String> modelPatterns();

        List<String> taskPatterns();

        boolean enabled();
    }

    abstract class Abstract<C extends Candidate> implements DiscountProvider {

        @Override
        public final Optional<DiscountResolver.AppliedDiscount> resolve(PricingContext ctx) {
            return loadCandidates(ctx).stream()
                    .filter(Candidate::enabled)
                    .filter(c -> Patterns.matchesAny(c.modelPatterns(), ctx.request().modelId()))
                    .filter(c -> Patterns.matchesAny(c.taskPatterns(), ctx.request().taskType()))
                    .filter(c -> matchesScope(c, ctx))
                    .min(java.util.Comparator.comparingInt(Candidate::discountBp))
                    .map(c -> new DiscountResolver.AppliedDiscount(
                            source(), c.id(), c.code(), c.discountBp()));
        }

        protected abstract List<C> loadCandidates(PricingContext ctx);

        protected boolean matchesScope(C candidate, PricingContext ctx) {
            return true;
        }
    }
}
