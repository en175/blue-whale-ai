package com.bluewhale.billing.catalog;

import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.pricing.UsageDim;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 定价目录的**真库集成测试** —— 「配 JSON → 引擎算价」的端到端。
 *
 * <p>为什么必须真库跑：单测里 {@code CompiledRule} 是手工构造的，跳过了
 * **JSON 反序列化 + 表键规范化 + Flyway 建表**这一整段。而那一段恰恰是
 * 「运营改配置」到「引擎算得出价」之间唯一会出错的地方。
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

    private PricingEngine engine;

    @BeforeEach
    void setUp() {
        // 清成已知状态。用 DELETE 不用 TRUNCATE：TRUNCATE 在 Flyway 管的表上会隐式提交，
        // 且与测试事务语义冲突。
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        holder.reload();  // 清空后 reload → 无 active 版本，lookup 返回 null
        engine = PricingEngine.forMedia(holder);
    }

    private void publish(int version, String document, String status) {
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (?, ?, ?, 1, SHA2(?, 256), 'test', NOW(), '')
                """, version, status, document, version + ":" + document);
    }

    /** 一份覆盖三种模态的最小目录。 */
    private static String catalogJson() {
        return """
                {
                  "schemaVersion": 1,
                  "currency": "CNY",
                  "creditsPerYuan": 15,
                  "models": {
                    "seedream-4.0": {
                      "text2image": {
                        "baseUnit": "usage.succeededSlots",
                        "basePrice": {
                          "kind": "table",
                          "by": ["size"],
                          "table": { "Size=1K": 2000, "size=2k": 5000, "size=4k": 10000 }
                        },
                        "unitDenominator": 1,
                        "minCredits": 1
                      }
                    },
                    "seedance-2.5": {
                      "text2video": {
                        "baseUnit": "usage.seconds",
                        "basePrice": {
                          "kind": "table",
                          "by": ["size"],
                          "table": { "size=1024x1024": 2000 }
                        },
                        "multipliers": { "usage.referenceCount": 12000 },
                        "unitDenominator": 1,
                        "minCredits": 2
                      }
                    },
                    "mediakit-cutout": {
                      "cutout": {
                        "baseUnit": "constant:1",
                        "basePrice": { "kind": "const", "value": 3000 },
                        "unitDenominator": 1,
                        "minCredits": 3
                      }
                    }
                  },
                  "discountPolicy": { "stackMode": "multiply", "floorFactorBp": 3000 }
                }
                """;
    }

    @Test
    void 从库加载目录后_引擎能算出价() {
        publish(1, catalogJson(), "active");

        assertThat(holder.reload()).isTrue();
        assertThat(holder.currentVersion()).isEqualTo(1);

        // 图片：2k × 3 张 = 5000mc × 3 = 15 积分
        assertThat(engine.compute(
                new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("size", "2k"), "free"),
                Usage.of(UsageDim.SUCCEEDED_SLOTS, 3), T).credits())
                .isEqualTo(15);

        // 视频：1024x1024 每秒 2000mc × 5 秒 = 10000mc；
        //       参考素材**每单位** ×1.2（12000 万分比），2 个 → 2.4×
        //       10000 × 24000/10000 = 24000mc = 24 积分
        assertThat(engine.compute(
                new PricingRequest(42L, "seedance-2.5", "text2video", Map.of("size", "1024x1024"), "free"),
                new Usage(null, null, Map.of(UsageDim.SECONDS, 5L, UsageDim.REFERENCE_COUNT, 2L)), T).credits())
                .isEqualTo(24);

        // 按次：CONSTANT_ONE 恒为 1，不依赖 usage 上报
        assertThat(engine.compute(
                new PricingRequest(42L, "mediakit-cutout", "cutout", Map.of(), "free"),
                Usage.empty(), T).credits())
                .isEqualTo(3);
    }

    @Test
    void 表键大小写被规范化_运营写Size等于1K也能查到() {
        publish(1, catalogJson(), "active");
        holder.reload();

        // JSON 里故意写了 "Size=1K"（未规范化）；编译期重拼成 "size=1k"
        long credits = engine.compute(
                new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("SIZE", "1k"), "free"),
                Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

        assertThat(credits).isEqualTo(2);
    }

    @Test
    void 改价发布新版本_老版本仍可按冻结版本复现() {
        publish(1, catalogJson(), "active");
        holder.reload();
        assertThat(holder.currentVersion()).isEqualTo(1);

        // 运营调价：2k 从 5 积分涨到 8 积分
        publish(2, catalogJson().replace("\"size=2k\": 5000", "\"size=2k\": 8000"), "active");
        jdbc.update("UPDATE billing_pricing_catalogs SET status='retired' WHERE catalog_version=1");

        assertThat(holder.reload()).isTrue();
        assertThat(holder.currentVersion()).isEqualTo(2);

        var request = new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("size", "2k"), "free");
        var usage = Usage.of(UsageDim.SUCCEEDED_SLOTS, 1);

        // 新提交：按新价
        assertThat(engine.compute(request, usage, T).credits()).isEqualTo(8);

        // ★ 已提交任务：按冻结的 v1 复现 —— retired 版本必须仍可读，这是「改价不影响在途任务」的实现
        var frozenV1 = repository.loadVersion(1);
        assertThat(frozenV1).isNotNull();
        assertThat(PricingEngine.forMedia(
                (m, t) -> frozenV1.index().get(CatalogCompiler.indexKey(m, t)))
                .compute(request, usage, T).credits())
                .isEqualTo(5);
    }

    @Test
    void 目录编不过时_保持旧版本而不是清空() {
        publish(1, catalogJson(), "active");
        holder.reload();
        assertThat(holder.currentVersion()).isEqualTo(1);

        // 发布一份坏目录：baseUnit 是拼错的维度键
        publish(2, catalogJson().replace("\"usage.seconds\"", "\"usage.secondz\""), "active");
        jdbc.update("UPDATE billing_pricing_catalogs SET status='retired' WHERE catalog_version=1");

        // reload 失败 → 保持 v1，而非清空
        assertThat(holder.reload()).isFalse();
        assertThat(holder.currentVersion()).isEqualTo(1);

        // 计价仍可用（用旧版本）—— 一次配置错误不该放大成全站不可用
        assertThat(engine.compute(
                new PricingRequest(42L, "mediakit-cutout", "cutout", Map.of(), "free"),
                Usage.empty(), T).credits())
                .isEqualTo(3);
    }

    @Test
    void 没有生效目录时_拒绝计价而不是算成零() {
        // ⚠️ 必须用**全新的 holder**：@SpringBootTest 的 holder 是单例，
        //    而它的 reload() 失败时**保持旧版本**（这正是设计要的行为）——
        //    共用它会带着上一个测试加载的版本，测不到「从未加载过」这个分支。
        var freshHolder = new CatalogHolder(repository);
        var freshEngine = PricingEngine.forMedia(freshHolder);

        assertThat(freshHolder.currentVersion()).isEqualTo(-1);
        assertThat(freshHolder.lookup("seedream-4.0", "text2image")).isNull();

        // 降级为 0 会让「还没配价」变成「免费」——必须炸
        assertThatThrownBy(() -> freshEngine.compute(
                new PricingRequest(42L, "seedream-4.0", "text2image", Map.of("size", "2k"), "free"),
                Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T))
                .isInstanceOf(PricingEngine.RuleNotFoundException.class);
    }
}
