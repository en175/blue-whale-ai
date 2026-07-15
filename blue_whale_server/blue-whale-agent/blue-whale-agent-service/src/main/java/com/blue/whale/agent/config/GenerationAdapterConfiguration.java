package com.blue.whale.agent.config;

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
import com.blue.whale.agent.service.generation.OpenAiImageGenerationProvider;
import com.blue.whale.agent.service.generation.SeedanceAsyncGenerationProvider;
import com.blue.whale.agent.service.generation.SeedanceVideoGenerationProcessor;
import com.blue.whale.agent.service.generation.SeedanceVideoResultIngestor;
import com.blue.whale.agent.service.generation.TosGenerationStorage;
import com.blue.whale.agent.service.generation.VideoResultIngestor;
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

import java.time.Clock;
import java.time.Duration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(GenerationAdapterProperties.class)
public class GenerationAdapterConfiguration {

    private static final String MODE = "openai-tos";

    @Bean
    GenerationModeValidator generationModeValidator(GenerationAdapterProperties properties) {
        if (!"disabled".equals(properties.getMode()) && !MODE.equals(properties.getMode())) {
            throw new IllegalStateException("图片生成配置无效: mode");
        }
        return new GenerationModeValidator();
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
            GenerationAdapterReadiness readiness) {
        return new GenerationWorker(claimService, acceptanceService, provider, storage,
                videoProcessorProvider.getIfAvailable(), lifecycleService, imageProviderCallService);
    }

    @Bean
    @ConditionalOnProperty(prefix = "blue-whale.generation", name = "mode", havingValue = MODE)
    AssetObjectGarbageCollector assetObjectGarbageCollector(
            AssetObjectLifecycleService lifecycleService,
            TosGenerationStorage storage,
            GenerationAdapterReadiness readiness) {
        return new AssetObjectGarbageCollector(lifecycleService, storage);
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
