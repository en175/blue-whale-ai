package com.bluewhale.billing.catalog;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 目录编译期的换算率校验（{@link CatalogDocument#creditsPerYuan()}）。
 *
 * <p>纯函数测试，不起 Spring、不连 DB：换算率写错是**配置**问题，
 * 而配置问题必须在发布时就被拒——它一旦随版本落库，就会被 job 冻结、
 * 在结算时按老版本一直复现，靠人发现太晚。
 */
class CatalogCompilerTest {

    @Test
    void 换算率为零或负数_拒绝发布() {
        assertThatThrownBy(() -> CatalogCompiler.compile(catalogWith(0)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=0")
                // 报错必须说清这个字段是什么，否则运营对着一个数字不知道改哪个含义
                .hasMessageContaining("1 元等于多少积分")
                .hasMessageContaining("1 ~ 100000");

        assertThatThrownBy(() -> CatalogCompiler.compile(catalogWith(-1)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=-1");
    }

    @Test
    void 换算率大到明显不合理_拒绝发布() {
        // 上界之外不是「算不出来」，是「几乎肯定多敲了 0」——换算率错 = 全站口径错
        assertThatThrownBy(() -> CatalogCompiler.compile(catalogWith(100_001)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("creditsPerYuan=100001");
    }

    @Test
    void 正常换算率_通过并可被读回() {
        assertThatCode(() -> CatalogCompiler.compile(catalogWith(15))).doesNotThrowAnyException();

        // 边界值同样合法：区间是闭区间
        assertThatCode(() -> CatalogCompiler.compile(
                catalogWith(CatalogDocument.MIN_CREDITS_PER_YUAN))).doesNotThrowAnyException();
        assertThatCode(() -> CatalogCompiler.compile(
                catalogWith(CatalogDocument.MAX_CREDITS_PER_YUAN))).doesNotThrowAnyException();
    }

    @Test
    void 编译结果不含换算率_它在目录文档上而不是规则里() {
        // ★ 这条是给「别把 15 硬编码进 Java」立的桩：换算率只能从目录文档读，
        //   编译产物（引擎用的规则索引）里没有它的位置。
        var doc = catalogWith(15);
        assertThat(CatalogCompiler.compile(doc)).hasSize(1);
        assertThat(doc.creditsPerYuan()).isEqualTo(15);
    }

    /** 一份最小可编译目录，只换换算率。 */
    private static CatalogDocument catalogWith(int creditsPerYuan) {
        return new CatalogDocument(
                1,
                "CNY",
                creditsPerYuan,
                Map.of("mediakit-cutout", Map.of("cutout", new CatalogDocument.TaskRule(
                        null,
                        "constant:1",
                        new CatalogDocument.BasePrice("const", 3_000L, null, null),
                        null,
                        null,
                        1L,
                        1L,
                        null,
                        null))),
                null);
    }
}
