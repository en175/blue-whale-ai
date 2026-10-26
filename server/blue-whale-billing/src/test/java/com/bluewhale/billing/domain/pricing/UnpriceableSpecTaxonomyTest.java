package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.common.error.BillingErrorTaxonomy;
import com.bluewhale.billing.common.error.BillingErrorTaxonomy.Code;
import com.bluewhale.billing.common.error.BillingErrorTaxonomy.Surface;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UnpriceableSpecTaxonomyTest {

    @Test
    void 规格组合未配价_与规则缺失同一处置() {
        var failure = BillingErrorTaxonomy.classify(
                new BasePriceResolver.UnpriceableSpecException("model:7|task:t2i"),
                Surface.USER);

        assertThat(failure.code()).isEqualTo(Code.UNPRICEABLE);
    }
}
