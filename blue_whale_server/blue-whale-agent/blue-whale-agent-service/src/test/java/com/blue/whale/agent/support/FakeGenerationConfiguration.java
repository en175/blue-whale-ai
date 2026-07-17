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
import com.blue.whale.agent.service.governance.ContentReviewProperties;
import com.blue.whale.agent.service.governance.ContentReviewService;
import com.blue.whale.agent.service.governance.ReviewEvidence;
import com.blue.whale.agent.service.governance.ReviewEvidenceSource;
import com.blue.whale.agent.model.entity.ContentReview;
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

    // 测试专用证据源：无条件 pass，让使用本配置的 IT（生成接纳/生命周期/视频）SUCCESS
    // 路径照常通过 ContentReview；fail-closed 语义由 LocalFakeGenerationIT 在 mode=fake 下覆盖。
    // policyVersion 必须与 ContentReviewProperties 一致，否则 isValid 判定不匹配而 fail closed。
    @Bean
    @Primary
    ReviewEvidenceSource fakeReviewEvidenceSource(ContentReviewProperties contentReviewProperties) {
        String policyVersion = contentReviewProperties.getPolicyVersion();
        return request -> ReviewEvidence.pass(
                request.contentDigest(),
                ContentReview.MODALITY_IMAGE,
                ContentReview.DIRECTION_OUTPUT,
                policyVersion,
                "fake-test-review");
    }

    @Bean
    GenerationWorker generationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor,
            AssetObjectLifecycleService lifecycleService,
            ImageProviderCallService imageProviderCallService,
            ContentReviewService contentReviewService) {
        return new GenerationWorker(
                claimService, acceptanceService, provider, storage, videoProcessor,
                lifecycleService, imageProviderCallService, contentReviewService);
    }

    @Bean
    AssetObjectGarbageCollector assetObjectGarbageCollector(
            AssetObjectLifecycleService lifecycleService,
            FakeGenerationStorage storage) {
        return new AssetObjectGarbageCollector(lifecycleService, storage);
    }
}
