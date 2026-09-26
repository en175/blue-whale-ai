package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * 折扣组合器（《计费逻辑详细设计》§2.5.5）。
 *
 * <p>叠加策略：
 * <pre>
 *   最终系数 = 各来源系数（每个来源内部**已取最优、不叠加**）
 *             按 stackMode 合并
 *   最终系数 = max(最终系数, floorFactorBp)      ← 底线，防配错亏本
 * </pre>
 *
 * <table>
 *   <tr><th>stackMode</th><th>语义</th></tr>
 *   <tr><td>{@code multiply}（默认）</td><td>会员 8 折 × 活动 7 折 = 5.6 折（会员再享活动）</td></tr>
 *   <tr><td>{@code best}</td><td>取最优的那一个，不叠加</td></tr>
 * </table>
 *
 * <p><b>为什么要有底线</b>：运营在两张表里各配一个折扣时，没人会心算乘积。
 * 8 折 × 7 折已经 5.6 折，再来张券就是 3.9 折——底线把「配错」的后果限制在「少赚」而非「亏本」。
 */
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
            // multiply 与未知取值都走相乘 —— 默认更宽松，且未知取值不该静默变成「不打折」
            default -> applied.stream()
                    .mapToInt(AppliedDiscount::factorBp)
                    .reduce(10_000, (acc, bp) -> acc * bp / 10_000);
        };

        int floored = Math.max(combined, policy.floorFactorBpOrDefault());
        return new Discount(floored, applied);
    }
}
