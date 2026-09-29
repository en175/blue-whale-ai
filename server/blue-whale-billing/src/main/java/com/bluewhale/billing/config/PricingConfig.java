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
     * **算法必须是同一份代码**——否则同一笔钱在两条路上按两套算法算，
     * 影子对账（拿 Quote 的结果比对上游实际扣费）就再也说明不了问题。
     *
     * <p>⚠️ 「同一份代码」**不是**「同一个实例」：折扣解析器（{@link DiscountResolver}）
     * 是本算法的**构造参数**，所以折扣策略是挂在实例上的。结算那条路**必须**用冻结折扣
     * （理由见 {@code SettlementService} 类注释「为什么结算必须用『冻结的规则 + 冻结的折扣』」），
     * 它因此**另造一个实例**。
     *
     * <p>那不是违反上面这条约束：两条路共享的是**算法本身**，差的只是折扣从哪来。
     * 真正要守的是「算价那段逻辑只有一份」——本仓当前只有
     * {@link MediaPricingCalculator} 一个实现；**任何在预扣与结算两侧各接一个实现的接法**，
     * 都会让上面那句「按两套算法算」重新变成可能。
     *
     * <p>⚠️ 换算法**不止改这里一处**：结算侧（{@code SettlementService#engineAtHoldTime}）
     * 与测试用的 {@code PricingEngine.forMedia} 都是**直接 new** 具体的算法类，
     * 不经这个 bean。换掉下面那行的实现而不动那两处，就会各留一套 ——
     * 那正是本注释开头要防的那件事。
     */
    @Bean
    public AbstractPricingCalculator pricingCalculator(DiscountResolver discounts) {
        return new MediaPricingCalculator(discounts);
    }
}
