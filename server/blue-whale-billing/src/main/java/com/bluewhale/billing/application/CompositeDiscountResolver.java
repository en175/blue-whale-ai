package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

@Component
public class CompositeDiscountResolver implements DiscountResolver {

    private final List<DiscountProvider> providers;
    private final CatalogHolder catalog;

    public CompositeDiscountResolver(List<DiscountProvider> providers, CatalogHolder catalog) {
        this.providers = List.copyOf(providers);
        this.catalog = catalog;
    }

    @Override
    public Discount resolve(PricingContext ctx) {
        List<AppliedDiscount> applied = providers.stream()
                .map(p -> p.resolve(ctx))
                .flatMap(Optional::stream)
                .toList();

        if (applied.isEmpty()) {
            return Discount.none();
        }

        CatalogDocument.DiscountPolicy policy = catalog.currentDiscountPolicy();
        int combined = switch (policy.stackModeOrDefault()) {
            case CatalogDocument.DiscountPolicy.BEST ->
                    applied.stream().mapToInt(AppliedDiscount::factorBp).min().orElse(10_000);
            default -> applied.stream()
                    .mapToInt(AppliedDiscount::factorBp)
                    .reduce(10_000, (acc, bp) -> acc * bp / 10_000);
        };

        int floored = Math.max(combined, policy.floorFactorBpOrDefault());
        return new Discount(floored, applied);
    }
}
