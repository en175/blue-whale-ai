package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationProviderResult;

import java.util.Base64;
import java.util.Map;

public class FakeGenerationProvider implements GenerationProvider {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    @Override
    public GenerationProviderResult generate(Map<String, Object> input) {
        String prompt = String.valueOf(input.get("prompt"));
        if ("fake:failure".equals(prompt)) {
            return GenerationProviderResult.failure("provider_failed", "Fake Provider 显式失败");
        }
        if ("fake:no-result".equals(prompt)) {
            return GenerationProviderResult.noResult();
        }
        return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png");
    }
}
