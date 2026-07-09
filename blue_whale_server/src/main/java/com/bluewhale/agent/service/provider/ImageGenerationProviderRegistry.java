package com.bluewhale.agent.service.provider;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Provider 注册表：收集所有 {@link ImageGenerationProvider} 实现，按 {@code provider_id} 路由。
 */
@Component
public class ImageGenerationProviderRegistry {

    private final Map<String, ImageGenerationProvider> providers = new ConcurrentHashMap<>();

    public ImageGenerationProviderRegistry(ObjectProvider<List<ImageGenerationProvider>> providerListProvider) {
        List<ImageGenerationProvider> list = providerListProvider.getIfAvailable(List::of);
        for (ImageGenerationProvider provider : list) {
            providers.put(provider.getProviderId(), provider);
        }
    }

    /** 按 provider_id 获取 Provider；不存在则抛异常。 */
    public ImageGenerationProvider getProvider(String providerId) {
        ImageGenerationProvider provider = providers.get(providerId);
        if (provider == null) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "不支持的 provider: " + providerId);
        }
        return provider;
    }
}
