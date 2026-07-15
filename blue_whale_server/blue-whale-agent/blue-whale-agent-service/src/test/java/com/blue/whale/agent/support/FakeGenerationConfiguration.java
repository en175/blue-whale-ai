package com.blue.whale.agent.support;

import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import com.blue.whale.agent.service.ImageProviderCallService;
import com.blue.whale.agent.service.generation.AssetObjectGarbageCollector;
import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.SeedanceVideoGenerationProcessor;
import com.blue.whale.agent.service.generation.VideoIngestedResult;
import com.blue.whale.agent.service.generation.VideoResultIngestor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

@TestConfiguration
public class FakeGenerationConfiguration {

    @Bean
    FakeGenerationProvider fakeGenerationProvider() {
        return new FakeGenerationProvider();
    }

    @Bean
    FakeGenerationStorage fakeGenerationStorage() {
        return new FakeGenerationStorage();
    }

    @Bean
    @Primary
    FakeAsyncGenerationProvider fakeAsyncGenerationProvider() {
        return new FakeAsyncGenerationProvider();
    }

    @Bean
    @Primary
    VideoResultIngestor fakeVideoResultIngestor(FakeGenerationStorage storage) {
        return (jobId, slotIndex, temporaryResultUrl, providerDurationSeconds, expectedDurationSeconds) -> {
            byte[] content = "fake-mp4".getBytes(StandardCharsets.UTF_8);
            return new VideoIngestedResult(storage.storeVideo(jobId, slotIndex,
                    new ByteArrayInputStream(content), content.length, "video/mp4"),
                    expectedDurationSeconds);
        };
    }

    @Bean
    GenerationWorker generationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor,
            AssetObjectLifecycleService lifecycleService,
            ImageProviderCallService imageProviderCallService) {
        return new GenerationWorker(
                claimService, acceptanceService, provider, storage, videoProcessor,
                lifecycleService, imageProviderCallService);
    }

    @Bean
    AssetObjectGarbageCollector assetObjectGarbageCollector(
            AssetObjectLifecycleService lifecycleService,
            FakeGenerationStorage storage) {
        return new AssetObjectGarbageCollector(lifecycleService, storage);
    }
}
