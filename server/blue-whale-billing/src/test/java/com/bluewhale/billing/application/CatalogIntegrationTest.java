package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CatalogRepository;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingEngine;
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
class CatalogIntegrationTest {

    private static final LocalDateTime T = LocalDateTime.parse("2026-10-15T22:30:00");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private CatalogRepository repository;

    @Autowired
    private CatalogHolder holder;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        holder.reload();
    }

    private void publish(int version, String document, String status) {
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (?, ?, ?, 1, SHA2(?, 256), 'test', NOW(), '')
                """, version, status, document, version + ":" + document);
    }

    private static String catalogJson(int creditsPerYuan) {
        return """
                {
                  "schemaVersion": 1,
                  "currency": "CNY",
                  "creditsPerYuan": %d,
                  "discountPolicy": { "stackMode": "multiply", "floorFactorBp": 3000 }
                }
                """.formatted(creditsPerYuan);
    }

    @Test
    void 从库加载目录_版本换算率与折扣策略都可读() {
        publish(1, catalogJson(15), "active");

        assertThat(holder.reload()).isTrue();
        assertThat(holder.currentVersion()).isEqualTo(1);
        assertThat(holder.currentCreditsPerYuan()).isEqualTo(15);
        assertThat(holder.currentDiscountPolicy().stackModeOrDefault()).isEqualTo("multiply");
        assertThat(holder.currentDiscountPolicy().floorFactorBpOrDefault()).isEqualTo(3_000);
    }

    @Test
    void 老目录行里的models段被忽略_不需要数据迁移() {
        publish(1, """
                {
                  "schemaVersion": 1,
                  "currency": "CNY",
                  "creditsPerYuan": 15,
                  "models": {
                    "seedream-4.0": {
                      "text2image": {
                        "baseUnit": "usage.succeededSlots",
                        "basePrice": { "kind": "const", "value": 5000 },
                        "unitDenominator": 1
                      }
                    }
                  },
                  "discountPolicy": { "stackMode": "multiply", "floorFactorBp": 3000 }
                }
                """, "active");

        assertThat(holder.reload()).isTrue();
        assertThat(holder.currentVersion()).isEqualTo(1);
        assertThat(holder.currentCreditsPerYuan()).isEqualTo(15);
    }

    @Test
    void 改换算率发布新版本_老版本仍可按冻结版本读回() {
        publish(1, catalogJson(15), "active");
        holder.reload();
        assertThat(holder.currentVersion()).isEqualTo(1);

        publish(2, catalogJson(20), "active");
        jdbc.update("UPDATE billing_pricing_catalogs SET status='retired' WHERE catalog_version=1");

        assertThat(holder.reload()).isTrue();
        assertThat(holder.currentVersion()).isEqualTo(2);
        assertThat(holder.currentCreditsPerYuan()).isEqualTo(20);
    }

    @Test
    void 目录校验不过时_保持旧版本而不是清空() {
        publish(1, catalogJson(15), "active");
        holder.reload();
        assertThat(holder.currentVersion()).isEqualTo(1);

        publish(2, catalogJson(0), "active");
        jdbc.update("UPDATE billing_pricing_catalogs SET status='retired' WHERE catalog_version=1");

        assertThat(holder.reload()).isFalse();
        assertThat(holder.currentVersion()).isEqualTo(1);

        assertThat(holder.currentCreditsPerYuan()).isEqualTo(15);
    }

    @Test
    void 没有生效目录时_换算率读成负一而不是编一个数() {
        var freshHolder = new CatalogHolder(repository);

        assertThat(freshHolder.currentVersion()).isEqualTo(-1);
        assertThat(freshHolder.currentCreditsPerYuan()).isEqualTo(-1);
        assertThat(freshHolder.currentDocumentJson()).isEmpty();
    }

    @Test
    void 规则快照_表键大小写被规范化后能算出价() {
        var rule = CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"table","by":["size"],
                   "table":{"Size=1K":2000,"size=2k":5000,"size=4k":10000}},
                 "unitDenominator":1,"minCredits":1}
                """);
        var engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);

        long credits = engine.compute(
                new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("SIZE", "1k"), "free"),
                Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

        assertThat(credits).isEqualTo(2);
    }
}
