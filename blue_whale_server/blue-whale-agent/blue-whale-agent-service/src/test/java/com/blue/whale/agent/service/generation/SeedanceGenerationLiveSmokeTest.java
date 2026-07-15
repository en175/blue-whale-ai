package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.volcengine.ark.runtime.service.ArkService;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.ObjectProvider;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Tag("live")
@EnabledIfEnvironmentVariable(named = "SEEDANCE_LIVE_SMOKE", matches = "true")
class SeedanceGenerationLiveSmokeTest {

    @Test
    @SuppressWarnings("unchecked")
    void submitsObservesAndStoresOnePrivateFourSecondVideo() throws Exception {
        GenerationAdapterProperties properties = propertiesFromEnvironment();
        ArkService arkService = ArkService.builder()
                .apiKey(requireEnvironment("ARK_API_KEY"))
                .baseUrl(System.getenv().getOrDefault(
                        "ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"))
                .timeout(Duration.ofMinutes(10))
                .build();
        ObjectProvider<ArkService> serviceProvider = mock(ObjectProvider.class);
        when(serviceProvider.getIfAvailable()).thenReturn(arkService);
        SeedanceAsyncGenerationProvider provider = new SeedanceAsyncGenerationProvider(
                serviceProvider, mock(ProjectAssetAccessService.class), properties);
        TOSV2 tosClient = new TOSV2ClientBuilder().build(
                properties.getTos().getRegion(), properties.getTos().getEndpoint(),
                properties.getTos().getAccessKey(), properties.getTos().getSecretKey());
        TosGenerationStorage storage = new TosGenerationStorage(
                tosClient, properties, Clock.systemUTC());
        SeedanceVideoResultIngestor ingestor = new SeedanceVideoResultIngestor(
                new OkHttpClient.Builder().readTimeout(Duration.ofMinutes(10)).build(),
                storage, properties);
        long smokeJobId = System.currentTimeMillis();

        try {
            ProviderTaskReference reference = provider.submit(new AsyncGenerationSpec(
                    smokeJobId, 1L, "A blue whale swimming in a calm ocean, static camera",
                    null, "16:9", "480p", 4,
                    System.getenv().getOrDefault("SEEDANCE_SMOKE_CALLBACK_URL",
                            "https://example.invalid/api/webhooks/seedance/smoke/1?capability=smoke")));
            Instant deadline = Instant.now().plus(Duration.ofMinutes(30));
            ProviderObservation observation;
            do {
                observation = provider.observe(reference);
                if (observation.status() == ProviderObservation.Status.SUCCEEDED) {
                    VideoIngestedResult ingested = ingestor.ingest(
                            smokeJobId, observation.temporaryResultUrl(), observation.durationSeconds(), 4);
                    assertThat(ingested.stored().storageKey())
                            .isEqualTo(properties.getTos().getPrefix()
                                    + "/video/jobs/" + smokeJobId + "/slot-0.mp4");
                    assertThat(ingested.stored().mimeType()).isEqualTo("video/mp4");
                    assertThat(storage.sign(ingested.stored().storageKey()).url()).startsWith("http");
                    return;
                }
                assertThat(observation.status())
                        .isIn(ProviderObservation.Status.QUEUED, ProviderObservation.Status.RUNNING);
                Thread.sleep(5_000);
            } while (Instant.now().isBefore(deadline));

            if (observation.status() == ProviderObservation.Status.QUEUED) {
                provider.requestCancel(reference);
            }
            throw new AssertionError("Seedance live smoke 超过 30 分钟未完成");
        } finally {
            arkService.shutdownExecutor();
        }
    }

    private GenerationAdapterProperties propertiesFromEnvironment() {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.getTos().setAccessKey(requireEnvironment("GENERATION_TOS_ACCESS_KEY"));
        properties.getTos().setSecretKey(requireEnvironment("GENERATION_TOS_SECRET_KEY"));
        properties.getTos().setRegion(requireEnvironment("GENERATION_TOS_REGION"));
        properties.getTos().setEndpoint(requireEnvironment("GENERATION_TOS_ENDPOINT"));
        properties.getTos().setBucket(requireEnvironment("GENERATION_TOS_BUCKET"));
        properties.getTos().setPrefix(System.getenv().getOrDefault(
                "GENERATION_TOS_PREFIX", "generation-seedance-live-smoke"));
        return properties;
    }

    private String requireEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("启用 Seedance live smoke 时缺少环境变量: " + name);
        }
        return value;
    }
}
