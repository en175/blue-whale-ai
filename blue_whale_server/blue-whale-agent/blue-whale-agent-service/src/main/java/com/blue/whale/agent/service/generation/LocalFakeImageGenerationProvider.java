package com.blue.whale.agent.service.generation;

import java.util.Base64;

/**
 * 本地非生产确定性 Fake 图片 Provider：与真实图片 Provider 共用
 * {@link GenerationProvider} 产品中性请求/结果契约，不需要任何真实供应商凭据。
 * 仅供 {@code blue-whale.generation.mode=fake} 装配，生产环境禁止启用。
 *
 * <p>确定性指令（经 input.prompt 驱动，用于本地演练与集成测试的失败分支）：
 * {@code fake:failure} 显式失败、{@code fake:no-result} 无结果。
 */
public class LocalFakeImageGenerationProvider implements GenerationProvider {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    @Override
    public GenerationProviderResult generate(GenerationProviderRequest request) {
        String prompt = request.input() == null ? null : String.valueOf(request.input().get("prompt"));
        if ("fake:failure".equals(prompt)) {
            return GenerationProviderResult.failure("provider_failed", "Fake Provider 显式失败");
        }
        if ("fake:no-result".equals(prompt)) {
            return GenerationProviderResult.noResult();
        }
        return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png", 1, 1);
    }
}
