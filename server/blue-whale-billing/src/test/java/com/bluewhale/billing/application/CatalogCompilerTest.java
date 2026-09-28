package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 目录校验（{@link CatalogDocument#creditsPerYuan()}）与规则快照编译
 * （{@link CatalogCompiler#compileRuleSnapshot}）。
 *
 * <p>纯函数测试，不起 Spring、不连 DB：换算率写错是**配置**问题，
 * 而配置问题必须在发布时就被拒——它一旦随版本落库，新订单会按它发积分，
 * 靠人发现太晚。
 */
class CatalogCompilerTest {

    @Test
    void 换算率为零或负数_拒绝发布() {
        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(0)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=0")
                // 报错必须说清这个字段是什么，否则运营对着一个数字不知道改哪个含义
                .hasMessageContaining("1 元等于多少积分")
                .hasMessageContaining("1 ~ 100000");

        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(-1)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=-1");
    }

    @Test
    void 换算率大到明显不合理_拒绝发布() {
        // 上界之外不是「算不出来」，是「几乎肯定多敲了 0」——换算率错 = 全站口径错
        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(100_001)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=100001");
    }

    @Test
    void 正常换算率_通过并可被读回() {
        assertThatCode(() -> CatalogCompiler.validate(catalogWith(15))).doesNotThrowAnyException();

        // 边界值同样合法：区间是闭区间
        assertThatCode(() -> CatalogCompiler.validate(
                catalogWith(CatalogDocument.MIN_CREDITS_PER_YUAN))).doesNotThrowAnyException();
        assertThatCode(() -> CatalogCompiler.validate(
                catalogWith(CatalogDocument.MAX_CREDITS_PER_YUAN))).doesNotThrowAnyException();
    }

    @Test
    void 换算率不在编译产物里_它在目录文档上() {
        // ★ 这条是给「别把 15 硬编码进 Java」立的桩：换算率只能从目录文档读。
        //   校验是纯副作用（不产出任何东西），调用方要拿它得回文档上取。
        var doc = catalogWith(15);
        CatalogCompiler.validate(doc);
        assertThat(doc.creditsPerYuan()).isEqualTo(15);
    }

    @Test
    void 不支持的schemaVersion_拒绝发布() {
        assertThatThrownBy(() -> CatalogCompiler.validate(new CatalogDocument(2, "CNY", 15, null)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("schemaVersion=2");
    }

    @Test
    void 老目录行里的models段被忽略_不需要数据迁移() {
        // ★ 规则搬进能力行之后，库里的老目录行还带着 models 段。
        //   它由 FAIL_ON_UNKNOWN_PROPERTIES=false 忽略掉（见 CatalogRepository 的注释），
        //   所以这里拿一份带 models 的 JSON 反序列化 + 校验必须照常通过。
        var withModels = new com.fasterxml.jackson.databind.ObjectMapper()
                .configure(com.fasterxml.jackson.databind.DeserializationFeature
                        .FAIL_ON_UNKNOWN_PROPERTIES, false);

        CatalogDocument doc;
        try {
            doc = withModels.readValue("""
                    {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
                     "models":{"m":{"t":{"baseUnit":"constant:1",
                       "basePrice":{"kind":"const","value":10000}}}},
                     "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
                    """, CatalogDocument.class);
        } catch (Exception e) {
            throw new IllegalStateException("测试目录 JSON 解析失败", e);
        }

        assertThatCode(() -> CatalogCompiler.validate(doc)).doesNotThrowAnyException();
        assertThat(doc.creditsPerYuan()).isEqualTo(15);
        assertThat(doc.discountPolicy().stackModeOrDefault()).isEqualTo("multiply");
    }

    // ─────────────────────────────────────────────────────────────
    // 单条规则快照（随 Hold / Quote 请求从 backend 的能力行送来）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 规则快照_合法时编译出引擎能用的规则() {
        var rule = CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":3000},
                 "unitDenominator":1,"minCredits":1}
                """);

        // 线格式（能力行的 pricing 列）→ 领域对象：字段一个都不能错位
        assertThat(rule.baseUnit()).isEqualTo(UsageDim.CONSTANT_ONE);
        assertThat(rule.basePrice()).isEqualTo(new BasePriceResolver.Constant(3_000L));
        assertThat(rule.minCredits()).isEqualTo(1L);
    }

    @Test
    void 规则快照_容忍未知字段() {
        // 能力行可能先我们一步多写一个字段（向前兼容），那不是脏数据。
        // 方向不能反：服务端认识而 JSON 里缺的必填字段仍要被拦下（见下一条）
        assertThatCode(() -> CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":3000},
                 "unitDenominator":1,"minCredits":1,"futureField":true}
                """)).doesNotThrowAnyException();
    }

    @Test
    void 规则快照_缺必填字段_拒绝() {
        // 缺 baseUnit：**拒单**，不能算出一个像模像样的价
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"basePrice\":{\"kind\":\"const\",\"value\":3000}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("baseUnit");
    }

    @Test
    void 规则快照_不是合法JSON或不是一条规则_拒绝() {
        // 送来的根本不是 JSON
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot("这不是 JSON"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则快照解析失败");

        // 是合法 JSON，但形状不是「一条规则」（比如误把整份目录送来了）：
        // 每个必填字段都取不到 → 编译期就拒，不会算出一个像模像样的价
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"schemaVersion\":1,\"creditsPerYuan\":15,\"models\":{\"m\":{\"t\":{\"baseUnit\":\"constant:1\"}}}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class);

        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot("null"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则为空");
    }

    /** 一份最小目录，只换换算率。**不含任何规则**——规则只随请求来。 */
    private static CatalogDocument catalogWith(int creditsPerYuan) {
        return new CatalogDocument(1, "CNY", creditsPerYuan, null);
    }
}
