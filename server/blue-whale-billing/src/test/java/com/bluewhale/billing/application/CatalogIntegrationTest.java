package com.bluewhale.billing.application;

import com.bluewhale.billing.adapter.outbound.persistence.repository.CatalogRepository;
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

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 定价目录的**真库集成测试**。
 *
 * <p>为什么必须真库跑：目录文档要经 MySQL 的 JSON 列往返（读回来是它自己的规范化文本），
 * 而老行里还留着规则搬走之前的 {@code models} 段——那一段能不能被容错解析、
 * 表建得对不对，单测覆盖不到。
 *
 * <p>⚠️ <b>目录里没有计价规则</b>（规则住在模型能力行，随 Hold / Quote 以快照进出 billing），
 * 所以本类考的是「目录读得出来、校验得了、老行不用迁移」；
 * 「规则 JSON → 引擎算得出价」在 {@link CatalogCompilerTest} 与
 * {@code TokenEstimatorTest} 里考（规则不再经过库）。
 *
 * <p>门控：未设 {@code BILLING_DB_PASSWORD} 时整体跳过（与仓库里
 * {@code *_DATABASE_URL} 门控的既有做法一致）。本地跑：
 * <pre>
 *   export BILLING_DB_PASSWORD=$(docker inspect bw-mysql \
 *     --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MYSQL_ROOT_PASSWORD | cut -d= -f2)
 *   mvn -f server/pom.xml -pl blue-whale-billing -am test
 * </pre>
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class CatalogIntegrationTest {

    private static final Instant T = Instant.parse("2026-10-15T22:30:00+08:00");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private CatalogRepository repository;

    @Autowired
    private CatalogHolder holder;

    @BeforeEach
    void setUp() {
        // 清成已知状态。用 DELETE 不用 TRUNCATE：TRUNCATE 在 Flyway 管的表上会隐式提交，
        // 且与测试事务语义冲突。
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        holder.reload();  // 清空后 reload → 无 active 版本，换算率读成 -1
    }

    private void publish(int version, String document, String status) {
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (?, ?, ?, 1, SHA2(?, 256), 'test', NOW(), '')
                """, version, status, document, version + ":" + document);
    }

    /** 一份最小目录：只有换算率与折扣策略。 */
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
        // ★ 管理端与充值都靠它：换算率只能从目录读，不能硬编码
        assertThat(holder.currentCreditsPerYuan()).isEqualTo(15);
        assertThat(holder.currentDiscountPolicy().stackModeOrDefault()).isEqualTo("multiply");
        assertThat(holder.currentDiscountPolicy().floorFactorBpOrDefault()).isEqualTo(3_000);
    }

    @Test
    void 老目录行里的models段被忽略_不需要数据迁移() {
        // 规则搬进模型能力行之前发布的目录行就长这样：带一个 models 段。
        // 它必须能被照常解析（FAIL_ON_UNKNOWN_PROPERTIES=false），否则线上老行一读就炸。
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

        // 运营改口径：1 元 = 20 积分
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

        // 发布一份坏目录：换算率 0 —— 那是「多少元都换不到积分」
        publish(2, catalogJson(0), "active");
        jdbc.update("UPDATE billing_pricing_catalogs SET status='retired' WHERE catalog_version=1");

        // reload 失败 → 保持 v1，而非清空
        assertThat(holder.reload()).isFalse();
        assertThat(holder.currentVersion()).isEqualTo(1);

        // 换算率仍可用（用旧版本）—— 一次配置错误不该放大成全站不可用
        assertThat(holder.currentCreditsPerYuan()).isEqualTo(15);
    }

    @Test
    void 没有生效目录时_换算率读成负一而不是编一个数() {
        // ⚠️ 必须用**全新的 holder**：@SpringBootTest 的 holder 是单例，
        //    而它的 reload() 失败时**保持旧版本**（这正是设计要的行为）——
        //    共用它会带着上一个测试加载的版本，测不到「从未加载过」这个分支。
        var freshHolder = new CatalogHolder(repository);

        assertThat(freshHolder.currentVersion()).isEqualTo(-1);
        assertThat(freshHolder.currentCreditsPerYuan()).isEqualTo(-1);
        assertThat(freshHolder.currentDocumentJson()).isEmpty();
    }

    @Test
    void 规则快照_表键大小写被规范化后能算出价() {
        // 本仓的定价轴写法是「轴=值」，运营常写成 "Size=2K"；编译期重拼成 "size=2k"。
        // 这条钉的是「配 JSON → 引擎算价」这一段——规则不再经过库，快照直接编译。
        var rule = CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"table","by":["size"],
                   "table":{"Size=1K":2000,"size=2k":5000,"size=4k":10000}},
                 "unitDenominator":1,"minCredits":1}
                """);
        var engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);

        // 规格里故意写 "SIZE"/"1k"（未规范化），值取自那条 Size=1K（即 2000 mc = 2 积分）
        long credits = engine.compute(
                new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("SIZE", "1k"), "free"),
                Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

        assertThat(credits).isEqualTo(2);
    }
}
