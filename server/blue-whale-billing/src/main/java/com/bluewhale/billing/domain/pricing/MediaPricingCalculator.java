package com.bluewhale.billing.domain.pricing;

/**
 * 媒介类计价（图片 / 视频 / 音频 / 按次）。
 *
 * <p><b>全部继承默认实现</b>——这些模态的计量维度本来互斥（张数 / 秒数 / 次数），
 * 上游 usage 没有层级包含关系，不需要归一化。
 *
 * <p>它是个空类，但这**不是**「忘了写」：{@code compute()} 是 final，
 * 这个类**声明了「本模态不做归一化」这个决定**。将来图片也有层级 usage 时，
 * 覆写点就在这里，不用动骨架。
 */
public final class MediaPricingCalculator extends AbstractPricingCalculator {

    public MediaPricingCalculator(DiscountResolver discountResolver) {
        super(discountResolver);
    }

    public MediaPricingCalculator() {
        this(DiscountResolver.NONE);
    }
}
