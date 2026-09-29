package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy;
import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy.Code;
import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy.Surface;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link BasePriceResolver.UnpriceableSpecException} 是**包私有**的（刻意的：只有本包的
 * resolver 能造它），所以「它归哪个码」这条断言只能放在本包。
 *
 * <p>它必须与 {@link PricingEngine.RuleNotFoundException} 同一处置（{@code UNPRICEABLE}）：
 * 两者都是「按现有目录算不出价」，对调用方都是「这次提交不该继续」、对运维都是「去补配置」。
 * 漏了它，异常会掉到兜底的 {@code INTERNAL} —— 用户看到的是「billing 挂了」，
 * 而不是「这个模型没配价，换一个」。
 */
class UnpriceableSpecTaxonomyTest {

    @Test
    void 规格组合未配价_与规则缺失同一处置() {
        var failure = BillingErrorTaxonomy.classify(
                new BasePriceResolver.UnpriceableSpecException("model:7|task:t2i"),
                Surface.USER);

        assertThat(failure.code()).isEqualTo(Code.UNPRICEABLE);
    }
}
