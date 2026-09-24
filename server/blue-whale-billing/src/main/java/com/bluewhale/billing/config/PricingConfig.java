package com.bluewhale.billing.config;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.PricingEngine;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 计价引擎的装配。
 *
 * <p>为什么显式写这个 Bean，而不是让 {@link PricingEngine} 自己带 {@code @Component}：
 * 引擎的构造需要一个**策略**（折扣解析器）。用注解装配就得在该字段上挂
 * {@code @Autowired(required = false)} 之类的兜底，那等于把「忘了接线」变成一个
 * 静默降级——引擎照常工作，只是永远不打折。
 *
 * <p>放在 @Configuration 里，依赖缺失时**启动即失败**（Spring 找不到 bean 直接报错），
 * 而不是等某个用户发现「我是会员却没打折」。
 */
@Configuration
public class PricingConfig {

    @Bean
    public PricingEngine pricingEngine(CatalogHolder catalog, DiscountResolver discounts) {
        // ⚠️ 必须把 discounts 传进去。PricingEngine.forMedia 的第一个参数是规则查询、
        //    第二个是折扣策略，漏传会编译不过（刻意没有单参数重载，理由见该方法注释）。
        return PricingEngine.forMedia(catalog, discounts);
    }
}
