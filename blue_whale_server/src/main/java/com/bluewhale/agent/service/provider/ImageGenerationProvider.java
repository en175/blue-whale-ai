package com.bluewhale.agent.service.provider;

import com.bluewhale.agent.model.dto.ImageGenerationResult;
import com.bluewhale.agent.model.dto.ProviderImageGenerationRequest;

/**
 * 图片生成 Provider 抽象：隔离不同厂商（火山、OpenAI 等）的 SDK 调用细节。
 *
 * <p>新增厂商时只需新增一个实现类并注册为 Spring bean，业务层通过
 * {@link ImageGenerationProviderRegistry} 按 provider_id 路由。
 */
public interface ImageGenerationProvider {

    /** 返回 provider 标识，如 {@code volcengine}。 */
    String getProviderId();

    /** 执行图片生成，返回生成结果。 */
    ImageGenerationResult generate(ProviderImageGenerationRequest req);
}
