package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.service.ProjectAssetContentService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Clock;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

@Tag("live")
@EnabledIfEnvironmentVariable(named = "GENERATION_LIVE_SMOKE", matches = "true")
class GenerationAdapterLiveSmokeTest {

    @Test
    void generatesStoresReadsAndSignsOnePrivateImage() {
        GenerationAdapterProperties properties = propertiesFromEnvironment();
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), new ObjectMapper(), mock(ProjectAssetContentService.class), properties);
        TOSV2 tosClient = new TOSV2ClientBuilder().build(
                properties.getTos().getRegion(),
                properties.getTos().getEndpoint(),
                properties.getTos().getAccessKey(),
                properties.getTos().getSecretKey());
        TosGenerationStorage storage = new TosGenerationStorage(tosClient, properties, Clock.systemUTC());

        GenerationProviderResult generated = provider.generate(new GenerationProviderRequest(
                1L, 1L, Map.of("prompt", "A simple blue whale icon on a white background")));
        assertThat(generated.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);

        StoredGenerationObject stored = storage.store(generated.content(), generated.mimeType());
        assertThat(storage.read(stored.storageKey())).isEqualTo(generated.content());
        SignedGenerationObject signed = storage.sign(stored.storageKey());
        assertThat(signed.url()).startsWith("http");
        assertThat(signed.expiresAt()).isAfter(Clock.systemUTC().instant());
    }

    private GenerationAdapterProperties propertiesFromEnvironment() {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.getOpenai().setApiKey(requireEnvironment("OPENAI_API_KEY"));
        properties.getOpenai().setBaseUrl(
                System.getenv().getOrDefault("OPENAI_BASE_URL", "https://api.openai.com"));
        properties.getTos().setAccessKey(requireEnvironment("GENERATION_TOS_ACCESS_KEY"));
        properties.getTos().setSecretKey(requireEnvironment("GENERATION_TOS_SECRET_KEY"));
        properties.getTos().setRegion(requireEnvironment("GENERATION_TOS_REGION"));
        properties.getTos().setEndpoint(requireEnvironment("GENERATION_TOS_ENDPOINT"));
        properties.getTos().setBucket(requireEnvironment("GENERATION_TOS_BUCKET"));
        properties.getTos().setPrefix(
                System.getenv().getOrDefault("GENERATION_TOS_PREFIX", "generation-live-smoke"));
        return properties;
    }

    private String requireEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("启用 live smoke 时缺少环境变量: " + name);
        }
        return value;
    }
}
