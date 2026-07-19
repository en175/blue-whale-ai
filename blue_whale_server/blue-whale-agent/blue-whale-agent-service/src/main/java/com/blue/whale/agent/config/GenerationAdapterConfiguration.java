package com.blue.whale.agent.config;

import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import com.blue.whale.agent.service.ImageProviderCallService;
import com.blue.whale.agent.service.generation.GenerationAdapterProperties;
import com.blue.whale.agent.service.generation.AsyncGenerationProvider;
import com.blue.whale.agent.service.generation.AssetObjectGarbageCollector;
import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.GenerationWorkerScheduler;
import com.blue.whale.agent.service.generation.LocalDiskGenerationStorage;
import com.blue.whale.agent.service.generation.LocalFakeGenerationStorage;
import com.blue.whale.agent.service.generation.LocalFakeImageGenerationProvider;
import com.blue.whale.agent.service.generation.OpenAiImageGenerationProvider;
import com.blue.whale.agent.service.generation.VolcEngineImageGenerationProvider;
import com.blue.whale.agent.service.generation.SeedanceAsyncGenerationProvider;
import com.blue.whale.agent.service.generation.SeedanceVideoGenerationProcessor;
import com.blue.whale.agent.service.generation.SeedanceVideoResultIngestor;
import com.blue.whale.agent.service.generation.TosGenerationStorage;
import com.blue.whale.agent.service.generation.VideoResultIngestor;
import com.blue.whale.agent.service.governance.ContentReviewProperties;
import com.blue.whale.agent.service.governance.ContentReviewService;
import com.blue.whale.agent.service.governance.LocalFakeReviewEvidenceSource;
import com.blue.whale.agent.service.governance.NonProductionAcceptanceReviewEvidenceSource;
import com.blue.whale.agent.service.governance.PendingRealProviderReviewEvidenceSource;
import com.blue.whale.agent.service.governance.ReviewEvidenceSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volcengine.ark.runtime.service.ArkService;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import java.time.Clock;
import java.time.Duration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(GenerationAdapterProperties.class)
public class GenerationAdapterConfiguration {

    private static final String MODE = "openai-tos";
    private static final String FAKE_MODE = "fake";
    private static final String AGENT_PLAN_MODE = "agent-plan";
    private static final String ARK_PLAN_BASE_URL_FRAGMENT = "/plan/";

    @Bean
    GenerationModeValidator generationModeValidator(
            GenerationAdapterProperties properties, Environment environment) {
        validateMode(properties, environment);
        return new GenerationModeValidator();
    }

    static void validateMode(GenerationAdapterProperties properties, Environment environment) {
        String mode = properties.getMode();
        if (!"disabled".equals(mode) && !MODE.equals(mode)
                && !FAKE_MODE.equals(mode) && !AGENT_PLAN_MODE.equals(mode)) {
            throw new IllegalStateException("图片生成配置无效: mode");
        }
        if (FAKE_MODE.equals(mode)) {
            if (!properties.isFakeAllowed()) {
                throw new IllegalStateException(
                        "Fake 图片生成适配器仅限非生产环境显式启用: fake-allowed");
            }
            if (environment != null && environment.acceptsProfiles(Profiles.of("prod"))) {
                throw new IllegalStateException("Fake 图片生成适配器禁止在生产环境启用");
            }
        }
        // 受控真实验收（IK1NS3）：仅限 openai-tos 的非生产显式组合，其余组合拒绝启动
        if (properties.isAcceptanceAllowed()) {
            if (!MODE.equals(mode)) {
                throw new IllegalStateException(
                        "受控真实验收仅限 openai-tos 模式: acceptance-allowed");
            }
            if (environment != null && environment.acceptsProfiles(Profiles.of("prod"))) {
                throw new IllegalStateException("受控真实验收禁止在生产环境启用");
            }
        }
        // Agent Plan 模式（IK21O4）：ARK key/base-url 缺失即 fail-closed 报配置缺失，
        // base-url 必须含 /plan/ 端点（混用标准 /api/v3 会失败或产生额外费用），
        // 生产 profile 拒绝该模式启动。
        if (AGENT_PLAN_MODE.equals(mode)) {
            if (environment == null) {
                throw new IllegalStateException("Agent Plan 模式缺少 Environment 校验 ARK 配置");
            }
            if (environment.acceptsProfiles(Profiles.of("prod"))) {
                throw new IllegalStateException("Agent Plan 模式禁止在生产环境启用");
            }
            String arkKey = environment.getProperty("volcengine.ark.api-key");
            if (arkKey == null || arkKey.isBlank()) {
                throw new IllegalStateException(
                        "Agent Plan 模式缺少配置: volcengine.ark.api-key (ARK_API_KEY)");
            }
            String arkBaseUrl = environment.getProperty("volcengine.ark.base-url");
            if (arkBaseUrl == null || arkBaseUrl.isBlank()) {
                throw new IllegalStateException(
                        "Agent Plan 模式缺少配置: volcengine.ark.base-url (ARK_BASE_URL)");
            }
            if (!arkBaseUrl.contains(ARK_PLAN_BASE_URL_FRAGMENT)) {
                throw new IllegalStateException(
                        "Agent Plan 模式要求 base-url 含 /plan/ 端点: volcengine.ark.base-url");
            }
        }
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    GenerationAdapterReadiness generationAdapterReadiness(
            GenerationAdapterProperties properties,
            GenerationModeValidator modeValidator) {
        validate(properties);
        return new GenerationAdapterReadiness();
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    OkHttpClient generationOkHttpClient(GenerationAdapterReadiness readiness) {
        return new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(20))
                .readTimeout(Duration.ofMinutes(3))
                .writeTimeout(Duration.ofMinutes(3))
                .callTimeout(Duration.ofMinutes(4))
                .build();
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    TOSV2 generationTosClient(
            GenerationAdapterProperties properties,
            GenerationAdapterReadiness readiness) {
        GenerationAdapterProperties.Tos tos = properties.getTos();
        return new TOSV2ClientBuilder().build(
                tos.getRegion(), tos.getEndpoint(), tos.getAccessKey(), tos.getSecretKey());
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    TosGenerationStorage tosGenerationStorage(
            TOSV2 generationTosClient,
            GenerationAdapterProperties properties,
            GenerationAdapterReadiness readiness) {
        return new TosGenerationStorage(generationTosClient, properties, Clock.systemUTC());
    }

    // 生产真实审核供应商（ADR-0021 LLM Shield）未接入前，以 fail-closed 占位证据源
    // 保证真实供应商路径不绕过 ContentReview：unavailable → fail closed，不创建 Asset。
    // 受控真实验收（IK1NS3，acceptance-allowed=true 的非生产显式组合）替换为非生产
    // 确定性验收证据源；决定仍由 ContentReviewService 归一化并持久化。
    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    ReviewEvidenceSource reviewEvidenceSource(
            ContentReviewProperties contentReviewProperties,
            GenerationAdapterProperties generationAdapterProperties,
            GenerationAdapterReadiness readiness) {
        if (generationAdapterProperties.isAcceptanceAllowed()) {
            return new NonProductionAcceptanceReviewEvidenceSource(contentReviewProperties);
        }
        return new PendingRealProviderReviewEvidenceSource(contentReviewProperties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    GenerationProvider generationProvider(
            OkHttpClient generationOkHttpClient,
            ObjectMapper objectMapper,
            ProjectAssetContentService assetContentService,
            GenerationAdapterProperties properties,
            GenerationAdapterReadiness readiness) {
        return new OpenAiImageGenerationProvider(
                generationOkHttpClient, objectMapper, assetContentService, properties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    AsyncGenerationProvider asyncGenerationProvider(
            ObjectProvider<ArkService> arkServiceProvider,
            ProjectAssetAccessService assetAccessService,
            GenerationAdapterProperties properties,
            GenerationAdapterReadiness readiness) {
        return new SeedanceAsyncGenerationProvider(
                arkServiceProvider, assetAccessService, properties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    VideoResultIngestor videoResultIngestor(
            OkHttpClient generationOkHttpClient,
            TosGenerationStorage storage,
            GenerationAdapterProperties properties,
            AssetObjectLifecycleService lifecycleService,
            GenerationAdapterReadiness readiness) {
        return new SeedanceVideoResultIngestor(
                generationOkHttpClient, storage, properties, lifecycleService);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    GenerationWorker generationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            TosGenerationStorage storage,
            ObjectProvider<SeedanceVideoGenerationProcessor> videoProcessorProvider,
            AssetObjectLifecycleService lifecycleService,
            ImageProviderCallService imageProviderCallService,
            ContentReviewService contentReviewService,
            GenerationAdapterReadiness readiness) {
        return new GenerationWorker(claimService, acceptanceService, provider, storage,
                videoProcessorProvider.getIfAvailable(), lifecycleService, imageProviderCallService,
                contentReviewService);
    }

    // ===== 本地非生产 Fake 装配（mode=fake，需 fake-allowed 显式确认，禁止生产） =====

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = FAKE_MODE)
    LocalFakeImageGenerationProvider localFakeImageGenerationProvider(
            GenerationModeValidator modeValidator) {
        return new LocalFakeImageGenerationProvider();
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = FAKE_MODE)
    LocalFakeGenerationStorage localFakeGenerationStorage(GenerationModeValidator modeValidator) {
        return new LocalFakeGenerationStorage();
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = FAKE_MODE)
    LocalFakeReviewEvidenceSource localFakeReviewEvidenceSource(
            ContentReviewProperties contentReviewProperties,
            GenerationModeValidator modeValidator) {
        return new LocalFakeReviewEvidenceSource(contentReviewProperties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = FAKE_MODE)
    GenerationWorker fakeGenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            LocalFakeImageGenerationProvider provider,
            LocalFakeGenerationStorage storage,
            ObjectProvider<SeedanceVideoGenerationProcessor> videoProcessorProvider,
            AssetObjectLifecycleService lifecycleService,
            ImageProviderCallService imageProviderCallService,
            ContentReviewService contentReviewService,
            GenerationModeValidator modeValidator) {
        return new GenerationWorker(claimService, acceptanceService, provider, storage,
                videoProcessorProvider.getIfAvailable(), lifecycleService, imageProviderCallService,
                contentReviewService);
    }

    // ===== Agent Plan 模式装配（IK21O4 地基 + IK21O5 火山 Provider）：本地磁盘存储 +
    // 非生产确定性验收证据源 + 火山方舟 GenerationProvider + GenerationWorker =====
    // Provider 真实调用方舟 /plan/v3（ArkService base-url 已校验含 /plan/），b64_json 免二次下载；
    // GenerationWorkerScheduler 经 ObjectProvider 惰性解析，无 worker 时空转，启动不受影响。

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = AGENT_PLAN_MODE)
    LocalDiskGenerationStorage localDiskGenerationStorage(
            GenerationAdapterProperties properties,
            GenerationModeValidator modeValidator) {
        return new LocalDiskGenerationStorage(properties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = AGENT_PLAN_MODE)
    ReviewEvidenceSource agentPlanReviewEvidenceSource(
            ContentReviewProperties contentReviewProperties,
            GenerationModeValidator modeValidator) {
        return new NonProductionAcceptanceReviewEvidenceSource(contentReviewProperties);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = AGENT_PLAN_MODE)
    GenerationProvider agentPlanGenerationProvider(
            ObjectProvider<ArkService> arkServiceProvider,
            ProjectAssetContentService assetContentService,
            GenerationModelCapabilityMapper capabilityMapper,
            GenerationModeValidator modeValidator) {
        return new VolcEngineImageGenerationProvider(
                arkServiceProvider, assetContentService, capabilityMapper);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = AGENT_PLAN_MODE)
    GenerationWorker agentPlanGenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider agentPlanGenerationProvider,
            LocalDiskGenerationStorage localDiskGenerationStorage,
            ObjectProvider<SeedanceVideoGenerationProcessor> videoProcessorProvider,
            AssetObjectLifecycleService assetObjectLifecycleService,
            ImageProviderCallService imageProviderCallService,
            ContentReviewService contentReviewService,
            GenerationModeValidator modeValidator) {
        return new GenerationWorker(claimService, acceptanceService, agentPlanGenerationProvider,
                localDiskGenerationStorage, videoProcessorProvider.getIfAvailable(),
                assetObjectLifecycleService, imageProviderCallService, contentReviewService);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    AssetObjectGarbageCollector assetObjectGarbageCollector(
            AssetObjectLifecycleService lifecycleService,
            TosGenerationStorage storage,
            GenerationAdapterReadiness readiness) {
        return new AssetObjectGarbageCollector(lifecycleService, storage);
    }

    /**
     * 生成任务认领调度器。无条件注册（仅保留 worker-scheduled 开关），调度器内部经
     * ObjectProvider 惰性解析 GenerationWorker——{@code @ConditionalOnBean} 依赖注册顺序，
     * 曾把调度器静默跳过导致 GenerationJob 永远 queued（IK1NS2 修复）。
     */
    @Bean
    @ConditionalOnProperty(
            prefix = "blue-whale.generation",
            name = "worker-scheduled",
            havingValue = "true",
            matchIfMissing = true)
    GenerationWorkerScheduler generationWorkerScheduler(ObjectProvider<GenerationWorker> workerProvider) {
        return new GenerationWorkerScheduler(workerProvider);
    }

    private void validate(GenerationAdapterProperties properties) {
        GenerationAdapterProperties.OpenAi openAi = properties.getOpenai();
        requireText("openai.api-key", openAi.getApiKey());
        requireText("openai.base-url", openAi.getBaseUrl());
        HttpUrl openAiBaseUrl = HttpUrl.parse(openAi.getBaseUrl());
        if (openAiBaseUrl == null
                || !"/".equals(openAiBaseUrl.encodedPath())
                || openAiBaseUrl.query() != null
                || openAiBaseUrl.fragment() != null
                || !openAiBaseUrl.username().isEmpty()
                || !openAiBaseUrl.password().isEmpty()) {
            throw new IllegalStateException("图片生成配置无效: openai.base-url 必须为服务根地址");
        }
        if (!"http".equals(openAiBaseUrl.scheme()) && !"https".equals(openAiBaseUrl.scheme())) {
            throw new IllegalStateException("图片生成配置无效: openai.base-url");
        }
        if (!"gpt-image-2".equals(openAi.getModel())) {
            throw new IllegalStateException("图片生成配置无效: openai.model 必须为 gpt-image-2");
        }
        if (openAi.getMaxImageBytes() <= 0) {
            throw new IllegalStateException("图片生成配置无效: openai.max-image-bytes");
        }

        GenerationAdapterProperties.Tos tos = properties.getTos();
        requireText("tos.access-key", tos.getAccessKey());
        requireText("tos.secret-key", tos.getSecretKey());
        requireText("tos.region", tos.getRegion());
        requireText("tos.endpoint", tos.getEndpoint());
        requireText("tos.bucket", tos.getBucket());
        requireText("tos.prefix", tos.getPrefix());
        HttpUrl tosEndpoint = HttpUrl.parse("https://" + tos.getEndpoint());
        if (tosEndpoint == null
                || !"/".equals(tosEndpoint.encodedPath())
                || tosEndpoint.query() != null
                || tosEndpoint.fragment() != null
                || !tosEndpoint.username().isEmpty()
                || !tosEndpoint.password().isEmpty()) {
            throw new IllegalStateException("图片生成配置无效: tos.endpoint");
        }
        String prefix = tos.getPrefix();
        if (prefix.startsWith("/")
                || prefix.endsWith("/")
                || prefix.contains("//")
                || prefix.contains("\\")
                || prefix.lines().count() != 1
                || java.util.Arrays.stream(prefix.split("/"))
                .anyMatch(segment -> ".".equals(segment) || "..".equals(segment))) {
            throw new IllegalStateException("图片生成配置无效: tos.prefix");
        }
        if (tos.getSignedUrlTtlSeconds() <= 0 || tos.getSignedUrlTtlSeconds() > 604800) {
            throw new IllegalStateException("图片生成配置无效: tos.signed-url-ttl-seconds");
        }
        if (tos.getMaxReadBytes() <= 0) {
            throw new IllegalStateException("图片生成配置无效: tos.max-read-bytes");
        }
        if (tos.getMaxVideoBytes() <= 0) {
            throw new IllegalStateException("视频生成配置无效: tos.max-video-bytes");
        }

        GenerationAdapterProperties.Seedance seedance = properties.getSeedance();
        requireText("seedance.account-id", seedance.getAccountId());
        if (!seedance.getAccountId().matches("[A-Za-z0-9._-]+")) {
            throw new IllegalStateException("视频生成配置无效: seedance.account-id");
        }
        requireText("seedance.callback-base-url", seedance.getCallbackBaseUrl());
        HttpUrl callbackBaseUrl = HttpUrl.parse(seedance.getCallbackBaseUrl());
        if (callbackBaseUrl == null
                || !"https".equals(callbackBaseUrl.scheme())
                || !"/".equals(callbackBaseUrl.encodedPath())
                || callbackBaseUrl.query() != null
                || callbackBaseUrl.fragment() != null
                || !callbackBaseUrl.username().isEmpty()
                || !callbackBaseUrl.password().isEmpty()) {
            throw new IllegalStateException("视频生成配置无效: seedance.callback-base-url");
        }
        if (seedance.getInitialPollSeconds() <= 0
                || seedance.getMaxPollSeconds() < seedance.getInitialPollSeconds()) {
            throw new IllegalStateException("视频生成配置无效: seedance.poll-seconds");
        }
        if (seedance.getAllowedResultHostSuffixes() == null
                || seedance.getAllowedResultHostSuffixes().isEmpty()
                || seedance.getAllowedResultHostSuffixes().stream().anyMatch(
                suffix -> suffix == null || !suffix.matches("[A-Za-z0-9.-]+")
                        || suffix.startsWith(".") || suffix.endsWith("."))) {
            throw new IllegalStateException(
                    "视频生成配置无效: seedance.allowed-result-host-suffixes");
        }
    }

    private void requireText(String name, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少图片生成配置: " + name);
        }
    }

    static final class GenerationAdapterReadiness {
    }

    static final class GenerationModeValidator {
    }
}
