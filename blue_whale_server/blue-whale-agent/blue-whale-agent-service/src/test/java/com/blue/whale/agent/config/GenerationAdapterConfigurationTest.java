package com.blue.whale.agent.config;

import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import com.blue.whale.agent.service.ImageProviderCallService;
import com.blue.whale.agent.service.generation.GenerationObjectSigner;
import com.blue.whale.agent.service.generation.AsyncGenerationProvider;
import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.VideoResultIngestor;
import com.blue.whale.agent.service.governance.ContentReviewProperties;
import com.blue.whale.agent.service.governance.ContentReviewService;
import com.blue.whale.agent.service.governance.NonProductionAcceptanceReviewEvidenceSource;
import com.blue.whale.agent.service.governance.PendingRealProviderReviewEvidenceSource;
import com.blue.whale.agent.service.governance.ReviewEvidenceSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volcengine.tos.TOSV2;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class GenerationAdapterConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(GenerationAdapterConfiguration.class)
            .withBean(ObjectMapper.class, ObjectMapper::new)
            .withBean(ProjectAssetContentService.class, () -> mock(ProjectAssetContentService.class))
            .withBean(ProjectAssetAccessService.class, () -> mock(ProjectAssetAccessService.class))
            .withBean(GenerationJobClaimService.class, () -> mock(GenerationJobClaimService.class))
            .withBean(AssetObjectLifecycleService.class,
                    () -> mock(AssetObjectLifecycleService.class))
            .withBean(ImageProviderCallService.class,
                    () -> mock(ImageProviderCallService.class))
            .withBean(GenerationResultAcceptanceService.class,
                    () -> mock(GenerationResultAcceptanceService.class))
            .withBean(ContentReviewService.class, () -> mock(ContentReviewService.class))
            .withBean(ContentReviewProperties.class, ContentReviewProperties::new);

    @Test
    void disabledModeRegistersNoProductionOrFakeAdapter() {
        contextRunner.run(context -> {
            assertThat(context).doesNotHaveBean(GenerationProvider.class);
            assertThat(context).doesNotHaveBean(GenerationStorage.class);
            assertThat(context).doesNotHaveBean(GenerationObjectSigner.class);
            assertThat(context).doesNotHaveBean(GenerationWorker.class);
            assertThat(context).doesNotHaveBean(AsyncGenerationProvider.class);
            assertThat(context).doesNotHaveBean(VideoResultIngestor.class);
            assertThat(context).doesNotHaveBean(TOSV2.class);
        });
    }

    @Test
    void unknownModeFailsInsteadOfSilentlyFallingBackToDisabled() {
        contextRunner
                .withPropertyValues("blue-whale.generation.mode=typo-mode")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("图片生成配置无效: mode");
                });
    }

    @Test
    void enabledModeFailsClosedWhenCredentialsAreMissing() {
        contextRunner
                .withPropertyValues("blue-whale.generation.mode=openai-tos")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("缺少图片生成配置: openai.api-key");
                });
    }

    @Test
    void enabledModeRegistersOpenAiAndPrivateTosAdapters() {
        contextRunner.withPropertyValues(validProperties())
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(GenerationProvider.class);
                    assertThat(context).hasSingleBean(GenerationStorage.class);
                    assertThat(context).hasSingleBean(GenerationObjectSigner.class);
                    assertThat(context).hasSingleBean(GenerationWorker.class);
                    assertThat(context).hasSingleBean(AsyncGenerationProvider.class);
                    assertThat(context).hasSingleBean(VideoResultIngestor.class);
                    assertThat(context).hasSingleBean(TOSV2.class);
                    // 生产真实模式默认保持 fail-closed 占位证据源
                    assertThat(context).getBean(ReviewEvidenceSource.class)
                            .isInstanceOf(PendingRealProviderReviewEvidenceSource.class);
                });
    }

    @Test
    void acceptanceModeRegistersNonProductionEvidenceSourceAlongsideRealAdapters() {
        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues("blue-whale.generation.acceptance-allowed=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(GenerationProvider.class);
                    assertThat(context).hasSingleBean(GenerationStorage.class);
                    assertThat(context).hasSingleBean(GenerationWorker.class);
                    assertThat(context).hasSingleBean(TOSV2.class);
                    assertThat(context).getBean(ReviewEvidenceSource.class)
                            .isInstanceOf(NonProductionAcceptanceReviewEvidenceSource.class);
                });
    }

    @Test
    void acceptanceModeFailsClosedWhenCredentialsAreMissing() {
        contextRunner
                .withPropertyValues(
                        "blue-whale.generation.mode=openai-tos",
                        "blue-whale.generation.acceptance-allowed=true")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("缺少图片生成配置: openai.api-key");
                });
    }

    @Test
    void acceptanceFlagRejectedWithNonOpenAiTosMode() {
        contextRunner
                .withPropertyValues(
                        "blue-whale.generation.mode=fake",
                        "blue-whale.generation.fake-allowed=true",
                        "blue-whale.generation.acceptance-allowed=true")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("受控真实验收仅限 openai-tos 模式: acceptance-allowed");
                });
    }

    @Test
    void acceptanceModeFailsClosedWhenConfigIsInvalid() {
        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues(
                        "blue-whale.generation.acceptance-allowed=true",
                        "blue-whale.generation.openai.base-url=https://api.openai.example/v1")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("图片生成配置无效: openai.base-url 必须为服务根地址");
                });
    }

    @Test
    void acceptanceModeRejectedUnderProductionProfile() {
        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues(
                        "blue-whale.generation.acceptance-allowed=true",
                        "spring.profiles.active=prod")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("受控真实验收禁止在生产环境启用");
                });
    }

    @Test
    void enabledModeRejectsOpenAiBaseUrlWithPath() {
        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues("blue-whale.generation.openai.base-url=https://api.openai.example/v1")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("图片生成配置无效: openai.base-url 必须为服务根地址");
                });
    }

    @Test
    void enabledModeRejectsInvalidTosEndpointAndPrefix() {
        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues("blue-whale.generation.tos.endpoint=https://tos.example/path")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("图片生成配置无效: tos.endpoint");
                });

        contextRunner.withPropertyValues(validProperties())
                .withPropertyValues("blue-whale.generation.tos.prefix=/generation")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("图片生成配置无效: tos.prefix");
                });
    }

    private String[] validProperties() {
        return new String[]{
                "blue-whale.generation.mode=openai-tos",
                "blue-whale.generation.openai.api-key=test-key",
                "blue-whale.generation.openai.base-url=https://api.openai.example",
                "blue-whale.generation.openai.model=gpt-image-2",
                "blue-whale.generation.tos.access-key=tos-key",
                "blue-whale.generation.tos.secret-key=tos-secret",
                "blue-whale.generation.tos.region=cn-beijing",
                "blue-whale.generation.tos.endpoint=tos-cn-beijing.volces.com",
                "blue-whale.generation.tos.bucket=private-bucket",
                "blue-whale.generation.seedance.callback-base-url=https://callback.example.test"
        };
    }
}
