package com.bluewhale.billing.infrastructure.discount;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.infrastructure.persistence.repository.CatalogRepository;
import com.bluewhale.billing.application.CompositeDiscountResolver;
import com.bluewhale.billing.domain.pricing.CompiledRule;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingContext;
import com.bluewhale.billing.domain.pricing.PricingRequest;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class DiscountResolverIntegrationTest {

    private static final LocalDateTime NIGHT = LocalDateTime.parse("2026-10-15T22:30:00");
    private static final LocalDateTime AFTERNOON = LocalDateTime.parse("2026-10-15T15:00:00");
    private static final LocalDateTime WEEKEND_NIGHT = LocalDateTime.parse("2026-10-17T22:30:00");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CatalogHolder catalog;
    @Autowired private CatalogRepository catalogRepository;
    @Autowired private MemberDiscountProvider memberProvider;
    @Autowired private PromotionDiscountProvider promotionProvider;
    @Autowired private CompositeDiscountResolver resolver;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_member_discounts");
        jdbc.update("DELETE FROM billing_promotions");
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (1, 'active', '{"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,"discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}',
                        1, SHA2('v1', 256), 'test', NOW(), '')
                """);
        catalog.reload();
    }

    private PricingContext ctx(String tier, String model, String task, LocalDateTime at) {
        return new PricingContext(
                CompiledRule.of(UsageDim.CONSTANT_ONE,
                        new com.bluewhale.billing.domain.pricing.BasePriceResolver.Constant(10_000L), 1L),
                new PricingRequest(42L, model, task, Map.of(), tier),
                Usage.empty(), at);
    }

    private void member(String tier, String modelPattern, String taskPattern, int bp) {
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) VALUES (?,?,?,?,'enabled')",
                tier, modelPattern, taskPattern, bp);
    }

    private void promotion(String code, int bp, String modelIds, String taskTypes,
                           String tierScope, String daysOfWeek,
                           String dailyStart, String dailyEnd,
                           String startAt, String endAt) {
        jdbc.update("INSERT INTO billing_promotions "
                        + "(code, name, discount_bp, model_ids, task_types, tier_scope, "
                        + " start_at, end_at, daily_time_start, daily_time_end, days_of_week, tz, status, created_by) "
                        + "VALUES (?,? ,?, ?,?, ?, ?, ?, ?, ?, ?, 'Asia/Shanghai', 'enabled', 'test')",
                code, code, bp, modelIds, taskTypes, tierScope,
                startAt, endAt, dailyStart, dailyEnd, daysOfWeek);
    }

    @Test
    void 会员折扣命中_并且同等级多条取最优() {
        member("pro", "*", "*", 9_500);
        member("pro", "seedance-*", "text2video", 8_000);
        member("free", "*", "*", 7_000);

        var hit = memberProvider.resolve(ctx("pro", "seedance-2.5", "text2video", NIGHT));

        assertThat(hit).isPresent();
        assertThat(hit.get().factorBp()).isEqualTo(8_000);
        assertThat(hit.get().source()).isEqualTo("member");
    }

    @Test
    void 会员折扣_无匹配等级时原价() {
        member("pro", "*", "*", 9_000);
        assertThat(memberProvider.resolve(ctx("free", "m", "t", NIGHT))).isEmpty();
    }

    @Test
    void 营销活动_时段内命中_时段外不命中() {
        promotion("NIGHT", 7_000, "[\"seedance-*\"]", "[\"text2video\"]", null,
                "[1,2,3,4,5]", "22:00:00", "06:00:00",
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        assertThat(promotionProvider.resolve(ctx("free", "seedance-2.5", "text2video", NIGHT)))
                .isPresent();
        assertThat(promotionProvider.resolve(ctx("free", "seedance-2.5", "text2video", AFTERNOON)))
                .isEmpty();
    }

    @Test
    void 营销活动_周几限制生效() {
        promotion("WEEKDAY_NIGHT", 7_000, "[\"*\"]", null, null,
                "[1,2,3,4,5]", "22:00:00", "06:00:00",
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        assertThat(promotionProvider.resolve(ctx("free", "m", "t", NIGHT))).isPresent();
        assertThat(promotionProvider.resolve(ctx("free", "m", "t", WEEKEND_NIGHT))).isEmpty();
    }

    @Test
    void 营销活动_跨天时段判定正确() {
        assertThat(PromotionDiscountProvider.inWindow(java.time.LocalTime.of(23, 0),
                java.time.LocalTime.of(22, 0), java.time.LocalTime.of(6, 0))).isTrue();
        assertThat(PromotionDiscountProvider.inWindow(java.time.LocalTime.of(3, 0),
                java.time.LocalTime.of(22, 0), java.time.LocalTime.of(6, 0))).isTrue();
        assertThat(PromotionDiscountProvider.inWindow(java.time.LocalTime.of(12, 0),
                java.time.LocalTime.of(22, 0), java.time.LocalTime.of(6, 0))).isFalse();
        assertThat(PromotionDiscountProvider.inWindow(java.time.LocalTime.of(12, 0),
                java.time.LocalTime.of(9, 0), java.time.LocalTime.of(18, 0))).isTrue();
        assertThat(PromotionDiscountProvider.inWindow(java.time.LocalTime.of(20, 0),
                java.time.LocalTime.of(9, 0), java.time.LocalTime.of(18, 0))).isFalse();
    }

    @Test
    void 营销活动_等级范围生效() {
        promotion("VIP_ONLY", 5_000, "[\"*\"]", null, "[\"pro\",\"max\"]", null, null, null,
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        assertThat(promotionProvider.resolve(ctx("pro", "m", "t", NIGHT))).isPresent();
        assertThat(promotionProvider.resolve(ctx("free", "m", "t", NIGHT))).isEmpty();
    }

    @Test
    void 营销活动_模型集合多项时任一命中即可() {
        promotion("MULTI", 6_000, "[\"seedance-*\",\"seedream-4.0\"]", null, null, null, null, null,
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        assertThat(promotionProvider.resolve(ctx("free", "seedance-2.5", "t", NIGHT))).isPresent();
        assertThat(promotionProvider.resolve(ctx("free", "seedream-4.0", "t", NIGHT))).isPresent();
        assertThat(promotionProvider.resolve(ctx("free", "kling-v1-5", "t", NIGHT))).isEmpty();
    }

    @Test
    void 组合_默认相乘_会员再享活动() {
        member("pro", "*", "*", 8_000);
        promotion("P7", 7_000, "[\"*\"]", null, null, null, null, null,
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        var discount = resolver.resolve(ctx("pro", "m", "t", NIGHT));

        assertThat(discount.factorBp()).isEqualTo(5_600);
        assertThat(discount.applied()).hasSize(2)
                .extracting(DiscountResolver.AppliedDiscount::source)
                .containsExactlyInAnyOrder("member", "promotion");
    }

    @Test
    void 组合_底线兜住叠加后的极低折扣() {
        member("max", "*", "*", 5_000);
        promotion("P5", 5_000, "[\"*\"]", null, null, null, null, null,
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        var discount = resolver.resolve(ctx("max", "m", "t", NIGHT));

        assertThat(discount.factorBp()).isEqualTo(3_000);
    }

    @Test
    void 组合_无命中时原价() {
        var discount = resolver.resolve(ctx("free", "m", "t", NIGHT));

        assertThat(discount.factorBp()).isEqualTo(10_000);
        assertThat(discount.isDiscounted()).isFalse();
        assertThat(discount.applied()).isEmpty();
    }

    @Test
    void 组合_best模式取最优不叠加() {
        jdbc.update("UPDATE billing_pricing_catalogs "
                + "SET document = JSON_SET(document, '$.discountPolicy.stackMode', 'best')");
        catalog.reload();
        assertThat(catalog.currentDiscountPolicy().stackModeOrDefault()).isEqualTo("best");

        member("pro", "*", "*", 8_000);
        promotion("P7", 7_000, "[\"*\"]", null, null, null, null, null,
                "2026-10-01 00:00:00", "2026-10-31 00:00:00");

        var discount = resolver.resolve(ctx("pro", "m", "t", NIGHT));

        assertThat(discount.factorBp()).isEqualTo(7_000);
    }
}
