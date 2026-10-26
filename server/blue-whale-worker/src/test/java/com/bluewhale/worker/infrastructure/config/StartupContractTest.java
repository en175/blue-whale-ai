package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.application.consumer.VideoConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.ImageCutoutJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageEraseJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.contract.JobTypeEnum;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.SystemSettingMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.env.MockEnvironment;

import javax.sql.DataSource;
import java.lang.reflect.RecordComponent;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class StartupContractTest {

    private final ApplicationContextRunner mqRunner = new ApplicationContextRunner()
            .withUserConfiguration(RocketMqConfig.class, NewApiUpstreamConfig.class)
            .withBean(MediaExtractJobProcessor.class, () -> mock(MediaExtractJobProcessor.class))
            .withBean(AudioJobProcessor.class, () -> mock(AudioJobProcessor.class))
            .withBean(ImageJobProcessor.class, () -> mock(ImageJobProcessor.class))
            .withBean(ImageEnhanceJobProcessor.class, () -> mock(ImageEnhanceJobProcessor.class))
            .withBean(ImageEraseJobProcessor.class, () -> mock(ImageEraseJobProcessor.class))
            .withBean(ImageCutoutJobProcessor.class, () -> mock(ImageCutoutJobProcessor.class))
            .withBean(VideoJobProcessor.class, () -> mock(VideoJobProcessor.class))
            .withBean(com.bluewhale.worker.application.processor.VideoSubtitleEraseJobProcessor.class,
                    () -> mock(com.bluewhale.worker.application.processor.VideoSubtitleEraseJobProcessor.class))
            .withBean(com.bluewhale.worker.application.processor.VideoEnhanceJobProcessor.class,
                    () -> mock(com.bluewhale.worker.application.processor.VideoEnhanceJobProcessor.class))
            .withBean(com.bluewhale.worker.application.processor.VideoSceneSplitJobProcessor.class,
                    () -> mock(com.bluewhale.worker.application.processor.VideoSceneSplitJobProcessor.class))
            .withBean(com.bluewhale.worker.application.processor.VideoMattingJobProcessor.class,
                    () -> mock(com.bluewhale.worker.application.processor.VideoMattingJobProcessor.class))
            .withBean(com.bluewhale.worker.application.processor.VideoFrameInterpolationJobProcessor.class,
                    () -> mock(com.bluewhale.worker.application.processor.VideoFrameInterpolationJobProcessor.class))
            .withBean(WorkerProperties.class, () -> new WorkerProperties(null))
            .withPropertyValues("NEW_API_BASE_URL=http://new-api.invalid");

    @Test
    @DisplayName("ROCKETMQ_ENDPOINTS 缺失 → 启动中止，失败信息点名 ROCKETMQ_ENDPOINTS")
    void missingRocketMqEndpointsAbortsStartup() {
        mqRunner.withPropertyValues("rocketmq.endpoints=").run(ctx -> {
            Throwable failure = ctx.getStartupFailure();
            assertThat(failure).as("缺 ROCKETMQ_ENDPOINTS 必须中止启动").isNotNull();
            assertThat(chainContains(failure, "ROCKETMQ_ENDPOINTS"))
                    .as("失败信息必须点名 ROCKETMQ_ENDPOINTS（缺配置即失败契约），实际：%s", failure)
                    .isTrue();
        });
    }

    @Test
    @DisplayName("DATABASE_URL 缺失 → 启动中止，失败信息为 DATABASE_URL environment variable is required")
    void missingDatabaseUrlAbortsStartup() {
        String databaseUrl = System.getenv("DATABASE_URL");
        Assumptions.assumeTrue(databaseUrl == null || databaseUrl.isBlank(),
                "本机已设 DATABASE_URL，缺失路径不可复现");

        new ApplicationContextRunner()
                .withUserConfiguration(DataSourceConfig.class)
                .run(ctx -> {
                    Throwable failure = ctx.getStartupFailure();
                    assertThat(failure).as("缺 DATABASE_URL 必须中止启动").isNotNull();
                    assertThat(chainContains(failure, "DATABASE_URL environment variable is required"))
                            .as("失败信息必须为既定的 DATABASE_URL 缺失文案，实际：%s", failure)
                            .isTrue();
                });
    }

    @Test
    @DisplayName("SYSTEM_SETTINGS_SECRET 缺失 → 装配期抛 IllegalStateException 且点名该变量")
    void missingSystemSettingsSecretAbortsStartup() {
        SystemSettingMapper mapper = mock(SystemSettingMapper.class);

        assertThatThrownBy(() -> new NewApiUpstreamConfig()
                .newApiUpstreamCredential(mapper, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(SystemSettingEnvelope.SECRET_ENV);

        assertThatThrownBy(() -> new NewApiUpstreamConfig()
                .newApiUpstreamCredential(mapper, new MockEnvironment()
                        .withProperty(SystemSettingEnvelope.SECRET_ENV, "   ")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(SystemSettingEnvelope.SECRET_ENV);
    }

    @Test
    @DisplayName("SYSTEM_SETTINGS_SECRET 到位 → 凭证读点装配成功（key 本身可以还没填）")
    void upstreamCredentialAssemblesWithoutConfiguredKey() {
        SystemSettingMapper mapper = mock(SystemSettingMapper.class);
        org.mockito.Mockito.when(mapper.selectValue(UpstreamCredential.SETTING_KEY))
                .thenReturn(null);

        UpstreamCredential credential = new NewApiUpstreamConfig().newApiUpstreamCredential(
                mapper,
                new MockEnvironment().withProperty(
                        SystemSettingEnvelope.SECRET_ENV,
                        SystemSettingEnvelopeVectors.FAKE_SECRET_HEX));

        assertThat(credential).isNotNull();
        assertThatThrownBy(credential::requireKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("未配置");
    }

    @Test
    @DisplayName("NEW_API_BASE_URL 缺失/空白 → 装配期抛 IllegalStateException 且点名该变量")
    void missingBaseUrlAbortsStartup() {
        assertThatThrownBy(() -> new UpstreamBaseUrl(null))
                .as("空值必须被拒")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(NewApiUpstreamConfig.ENV_BASE_URL);
        assertThatThrownBy(() -> new UpstreamBaseUrl("   "))
                .as("纯空白同样必须被拒")
                .isInstanceOf(IllegalStateException.class);

        assertThatThrownBy(() -> new NewApiUpstreamConfig().newApiBaseUrl(baseUrlEnv("")))
                .as("空串必须被拒（不返回空串继续跑）")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(NewApiUpstreamConfig.ENV_BASE_URL);
        assertThatThrownBy(() -> new NewApiUpstreamConfig().newApiBaseUrl(baseUrlEnv("   ")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("NEW_API_BASE_URL 齐备 → 地址 bean 装配成功，拼路径前去尾斜杠（口径不变）")
    void baseUrlPresentAssemblesBean() {
        assertThat(new NewApiUpstreamConfig().newApiBaseUrl(baseUrlEnv("http://new-api.invalid/"))
                .normalized())
                .as("尾斜杠必须剥掉，否则拼出 //v1")
                .isEqualTo("http://new-api.invalid");
    }

    private static StandardEnvironment baseUrlEnv(String baseUrl) {
        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test",
                Map.of(NewApiUpstreamConfig.ENV_BASE_URL, baseUrl)));
        return env;
    }

    @Test
    @DisplayName("DATABASE_URL 齐备 → 数据源正常装配（缺失分支的反面）")
    void databaseUrlPresentAssemblesDataSource() {
        String databaseUrl = System.getenv("DATABASE_URL");
        Assumptions.assumeTrue(databaseUrl != null && !databaseUrl.isBlank(),
                "本机未设 DATABASE_URL，齐备路径不可复现");

        new ApplicationContextRunner()
                .withUserConfiguration(DataSourceConfig.class)
                .run(ctx -> {
                    assertThat(ctx.getStartupFailure()).isNull();
                    assertThat(ctx).hasSingleBean(DataSource.class);
                });
    }

    @Test
    @DisplayName("视频 tag 跨三处一致：VideoConsumer.TAG = VideoJobProcessor.tag() = GenerationMqRoute.VIDEO.tag()")
    void videoTagPinnedAcrossConsumerProcessorAndRoute() {
        VideoJobProcessor processor = new VideoJobProcessor(
                mock(JobStateMachineService.class),
                mock(JobFinalizer.class),
                mock(AssetSourceService.class),
                mock(UpstreamCredential.class),
                mock(NewApiVideoClient.class),
                mock(TosVideoMediaRelay.class),
                mock(GenerationMessageProducer.class));

        assertThat(VideoConsumer.TAG).isEqualTo("video");
        assertThat(processor.tag()).isEqualTo(VideoConsumer.TAG);
        assertThat(GenerationMqRouteEnum.VIDEO.tag()).isEqualTo(VideoConsumer.TAG);
    }

    @Test
    @DisplayName("GenerationMqRoute 十八个入口的 topic / tag 与契约 §1 冻结值一致")
    void mqRouteTopicAndTagPinnedToContractValues() {
        Map<GenerationMqRouteEnum, String> expectedTags = Map.ofEntries(
                Map.entry(GenerationMqRouteEnum.VIDEO, "video"),
                Map.entry(GenerationMqRouteEnum.IMAGE, "image"),
                Map.entry(GenerationMqRouteEnum.AUDIO, "audio"),
                Map.entry(GenerationMqRouteEnum.MEDIA_EXTRACT, "media_extract"),
                Map.entry(GenerationMqRouteEnum.AUDIO_MIX, "audio_mix"),
                Map.entry(GenerationMqRouteEnum.AUDIO_VIDEO_MUX, "audio_video_mux"),
                Map.entry(GenerationMqRouteEnum.AUDIO_TRIM, "audio_trim"),
                Map.entry(GenerationMqRouteEnum.AUDIO_SPEED, "audio_speed"),
                Map.entry(GenerationMqRouteEnum.IMAGE_ENHANCE, "image_enhance"),
                Map.entry(GenerationMqRouteEnum.IMAGE_ERASE, "image_erase"),
                Map.entry(GenerationMqRouteEnum.IMAGE_CUTOUT, "image_cutout"),
                Map.entry(GenerationMqRouteEnum.IMAGE_OUTPAINT, "image_outpaint"),
                Map.entry(GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE, "video_subtitle_erase"),
                Map.entry(GenerationMqRouteEnum.VIDEO_ENHANCE, "video_enhance"),
                Map.entry(GenerationMqRouteEnum.VOCAL_SPLIT, "vocal_split"),
                Map.entry(GenerationMqRouteEnum.VIDEO_SCENE_SPLIT, "video_scene_split"),
                Map.entry(GenerationMqRouteEnum.VIDEO_MATTING, "video_matting"),
                Map.entry(GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION, "video_frame_interpolation"));

        assertThat(GenerationMqRouteEnum.values()).hasSize(expectedTags.size());
        for (GenerationMqRouteEnum route : GenerationMqRouteEnum.values()) {
            assertThat(route.topic()).as("%s 的 topic", route).isEqualTo("generation-task");
            assertThat(route.tag()).as("%s 的 tag", route).isEqualTo(expectedTags.get(route));
        }
    }

    @Test
    @DisplayName("GenerationMqRoute.tag() 与 JobType.value() 逐项同值")
    void mqRouteTagsMatchJobTypeValues() {
        assertThat(GenerationMqRouteEnum.VIDEO.tag()).isEqualTo(JobTypeEnum.VIDEO.value());
        assertThat(GenerationMqRouteEnum.IMAGE.tag()).isEqualTo(JobTypeEnum.IMAGE.value());
        assertThat(GenerationMqRouteEnum.AUDIO.tag()).isEqualTo(JobTypeEnum.AUDIO.value());
        assertThat(GenerationMqRouteEnum.MEDIA_EXTRACT.tag()).isEqualTo(JobTypeEnum.MEDIA_EXTRACT.value());
        assertThat(GenerationMqRouteEnum.AUDIO_MIX.tag()).isEqualTo(JobTypeEnum.AUDIO_MIX.value());
        assertThat(GenerationMqRouteEnum.AUDIO_VIDEO_MUX.tag()).isEqualTo(JobTypeEnum.AUDIO_VIDEO_MUX.value());
        assertThat(GenerationMqRouteEnum.AUDIO_TRIM.tag()).isEqualTo(JobTypeEnum.AUDIO_TRIM.value());
        assertThat(GenerationMqRouteEnum.AUDIO_SPEED.tag()).isEqualTo(JobTypeEnum.AUDIO_SPEED.value());
        assertThat(GenerationMqRouteEnum.IMAGE_ENHANCE.tag()).isEqualTo(JobTypeEnum.IMAGE_ENHANCE.value());
        assertThat(GenerationMqRouteEnum.IMAGE_ERASE.tag()).isEqualTo(JobTypeEnum.IMAGE_ERASE.value());
        assertThat(GenerationMqRouteEnum.IMAGE_CUTOUT.tag()).isEqualTo(JobTypeEnum.IMAGE_CUTOUT.value());
        assertThat(GenerationMqRouteEnum.IMAGE_OUTPAINT.tag()).isEqualTo(JobTypeEnum.IMAGE_OUTPAINT.value());
        assertThat(GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE.tag()).isEqualTo(JobTypeEnum.VIDEO_SUBTITLE_ERASE.value());
        assertThat(GenerationMqRouteEnum.VIDEO_ENHANCE.tag()).isEqualTo(JobTypeEnum.VIDEO_ENHANCE.value());
        assertThat(GenerationMqRouteEnum.VOCAL_SPLIT.tag()).isEqualTo(JobTypeEnum.VOCAL_SPLIT.value());
        assertThat(GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.tag()).isEqualTo(JobTypeEnum.VIDEO_SCENE_SPLIT.value());
        assertThat(GenerationMqRouteEnum.VIDEO_MATTING.tag()).isEqualTo(JobTypeEnum.VIDEO_MATTING.value());
        assertThat(GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.tag()).isEqualTo(JobTypeEnum.VIDEO_FRAME_INTERPOLATION.value());
    }

    @Test
    @DisplayName("退役的 ROCKETMQ_TOPIC / ROCKETMQ_TAG 残留属性被忽略（不报错、不生效）")
    void retiredTopicAndTagPropertiesAreIgnored() {
        RocketMqConfig.RocketMqProperties props = bindMqProps(Map.of(
                "rocketmq.endpoints", "127.0.0.1:8081",
                "rocketmq.topic", "generation-video",
                "rocketmq.tag", "step"));

        assertThat(props.endpoints()).isEqualTo("127.0.0.1:8081");
        assertThat(props.accessKey()).isEmpty();
        assertThat(props.secretKey()).isEmpty();
        assertThat(props.sslEnabled()).isFalse();
        assertThat(RocketMqConfig.RocketMqProperties.class.getRecordComponents())
                .extracting(RecordComponent::getName)
                .containsExactly("endpoints", "accessKey", "secretKey", "sslEnabled");
    }

    private static RocketMqConfig.RocketMqProperties bindMqProps(Map<String, Object> props) {
        ConfigurableEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", props));
        return Binder.get(env)
                .bind("rocketmq", RocketMqConfig.RocketMqProperties.class)
                .orElseGet(() -> new RocketMqConfig.RocketMqProperties("", "", "", false));
    }

    private static boolean chainContains(Throwable t, String needle) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (String.valueOf(c.getMessage()).contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
