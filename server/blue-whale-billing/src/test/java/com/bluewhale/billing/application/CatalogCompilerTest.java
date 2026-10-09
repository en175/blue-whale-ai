package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CatalogCompilerTest {

    @Test
    void 换算率为零或负数_拒绝发布() {
        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(0)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=0")
                .hasMessageContaining("1 元等于多少积分")
                .hasMessageContaining("1 ~ 100000");

        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(-1)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=-1");
    }

    @Test
    void 换算率大到明显不合理_拒绝发布() {
        assertThatThrownBy(() -> CatalogCompiler.validate(catalogWith(100_001)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=100001");
    }

    @Test
    void 正常换算率_通过并可被读回() {
        assertThatCode(() -> CatalogCompiler.validate(catalogWith(15))).doesNotThrowAnyException();

        assertThatCode(() -> CatalogCompiler.validate(
                catalogWith(CatalogDocument.MIN_CREDITS_PER_YUAN))).doesNotThrowAnyException();
        assertThatCode(() -> CatalogCompiler.validate(
                catalogWith(CatalogDocument.MAX_CREDITS_PER_YUAN))).doesNotThrowAnyException();
    }

    @Test
    void 换算率不在编译产物里_它在目录文档上() {
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


    @Test
    void 规则快照_合法时编译出引擎能用的规则() {
        var rule = CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":3000},
                 "unitDenominator":1,"minCredits":1}
                """);

        assertThat(rule.baseUnit()).isEqualTo(UsageDim.CONSTANT_ONE);
        assertThat(rule.basePrice()).isEqualTo(new BasePriceResolver.Constant(3_000L));
        assertThat(rule.minCredits()).isEqualTo(1L);
    }

    @Test
    void 规则快照_容忍未知字段() {
        assertThatCode(() -> CatalogCompiler.compileRuleSnapshot("""
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":3000},
                 "unitDenominator":1,"minCredits":1,"futureField":true}
                """)).doesNotThrowAnyException();
    }

    @Test
    void 规则快照_缺必填字段_拒绝() {
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"basePrice\":{\"kind\":\"const\",\"value\":3000}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("baseUnit");
    }

    @Test
    void 规则快照_不是合法JSON或不是一条规则_拒绝() {
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot("这不是 JSON"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则快照解析失败");

        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"schemaVersion\":1,\"creditsPerYuan\":15,\"models\":{\"m\":{\"t\":{\"baseUnit\":\"constant:1\"}}}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class);

        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot("null"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则为空");
    }

    private static CatalogDocument catalogWith(int creditsPerYuan) {
        return new CatalogDocument(1, "CNY", creditsPerYuan, null);
    }
}
