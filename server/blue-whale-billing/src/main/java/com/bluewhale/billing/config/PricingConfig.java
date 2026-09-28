package com.bluewhale.billing.config;

import com.bluewhale.billing.domain.pricing.AbstractPricingCalculator;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 计价引擎的装配。
 *
 * <p>这里只装配**算法**（骨架 + 折扣策略）；规则来源不在这里——
 * 计价规则住在模型能力行，由属主随 Hold / Quote 作为快照送来，
 * {@code BillingApplicationService} 拿它与下面这个算法实例拼出一次性引擎
 * （见 {@code BillingApplicationService#engineFor}）。所以**没有一个长期持有的
 * PricingEngine Bean**：那种 Bean 只有在「规则从某个常驻目录里查」时才成立。
 *
 * <p>放在 @Configuration 里，依赖缺失时**启动即失败**（Spring 找不到 bean 直接报错），
 * 而不是等某个用户发现「我是会员却没打折」。
 */
@Configuration
public class PricingConfig {

    /**
     * 计价算法（骨架 + 折扣策略）。
     *
     * <p>为什么它单独是一个 Bean、而不是只藏在引擎装配里：
     * 「算得对不对」与「规则从哪来」是两件事，需要分开装配。
     * 预扣/报价收下**规则快照**（随请求带来的那一条）时，换的只是规则来源，
     * 算法必须**完全同一个实例**——否则同一笔钱在两条路上按两套算法算，
     * 影子对账（拿 Quote 的结果比对上游实际扣费）就再也说明不了问题。
     *
     * <p>⚠️ 换个算法（比如将来图片也有了层级 usage）只改这里一处。
     */
    @Bean
    public AbstractPricingCalculator pricingCalculator(DiscountResolver discounts) {
        return new MediaPricingCalculator(discounts);
    }
}
