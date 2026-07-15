package com.blue.whale.agent.service.provider;

import com.blue.whale.agent.model.dto.ImageGenerationResult;
import com.blue.whale.agent.model.dto.ProviderImageGenerationRequest;
import com.volcengine.ark.runtime.model.images.generation.ImageGenStreamEvent;
import io.reactivex.Flowable;

/**
 * 图片生成 Provider 抽象：隔离不同厂商（火山、OpenAI 等）的 SDK 调用细节。
 *
 * <p>新增厂商时只需新增一个实现类并注册为 Spring bean，业务层通过
 * {@link ImageGenerationProviderRegistry} 按 provider_id 路由。
 */
public interface ImageGenerationProvider {

    /** 返回 provider 标识，如 {@code volcengine}。 */
    String getProviderId();

    /** 在任何付费网络调用前校验本地 Provider 配置。 */
    default void requireReady() {
    }

    /** 执行图片生成（同步），返回生成结果。 */
    ImageGenerationResult generate(ProviderImageGenerationRequest req);

    /** 是否支持流式生成（逐张返图）。默认 false，流式 Provider 覆盖为 true。 */
    default boolean supportsStreaming() {
        return false;
    }

    /**
     * 流式生成，返回事件流（{@link ImageGenStreamEvent}）。
     * 不支持流式的 Provider 抛 {@link UnsupportedOperationException}。
     */
    default Flowable<ImageGenStreamEvent> streamGenerateImages(ProviderImageGenerationRequest req) {
        throw new UnsupportedOperationException("provider " + getProviderId() + " 不支持流式生成");
    }
}
