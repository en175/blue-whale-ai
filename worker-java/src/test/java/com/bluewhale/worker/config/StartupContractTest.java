package com.bluewhale.worker.config;

import com.bluewhale.worker.application.consumer.VideoConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.ImageCutoutJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageEraseJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import com.bluewhale.worker.domain.entity.JobType;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
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

import javax.sql.DataSource;
import java.lang.reflect.RecordComponent;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 启动契约测试（ADR-0084 修正六：缺配置即启动失败）。
 * <p>
 * 修正六把启动语义从「空 tags → 静默只起 /ready」翻转为「缺配置 → bean 装配期响亮失败」。
 * 本测试逐条钉住翻转后的行为：
 * <ul>
 *   <li>缺 {@code ROCKETMQ_ENDPOINTS} → 启动中止且失败信息点名该变量；</li>
 *   <li>缺 {@code DATABASE_URL} → 启动中止且失败信息点名该变量；</li>
 *   <li>视频 tag 在「消费侧订阅值 / 处理器声明值 / 路由表」三处一致；</li>
 *   <li>{@link GenerationMqRoute} 六个入口的 topic / tag 与契约 §1 冻结值一致（可执行定义）；</li>
 *   <li>退役的 {@code ROCKETMQ_TOPIC} / {@code ROCKETMQ_TAG} 残留属性被忽略（不报错、不生效）。</li>
 * </ul>
 */
class StartupContractTest {

    /**
     * 装配 RocketMqConfig 所需的全部 processor 假体。
     * 本测试只关心配置校验路径，processor 行为无关。
     * <p>
     * 本 runner 的上下文里只有 {@link RocketMqConfig}：另外 5 个网关客户端
     * （audio / image / image_enhance / image_erase / image_cutout）是 {@code @Component}，不在此 runner 中扫描，
     * 且它们各自读 {@code System.getenv}——Spring 属性喂不到它们。这里需要 baseUrl 的只有
     * {@link RocketMqConfig} 自己声明的 {@code newApiVideoClient} 这一个客户端，
     * 故 {@code NEW_API_BASE_URL} 置哑值只为让它的构造期校验先通过，使 MQ 校验成为唯一失败点。
     * 往本 runner 添新客户端时须同步补它的启动期依赖，否则失败点会前移。
     */
    private final ApplicationContextRunner mqRunner = new ApplicationContextRunner()
            .withUserConfiguration(RocketMqConfig.class)
            .withBean(MediaExtractJobProcessor.class, () -> mock(MediaExtractJobProcessor.class))
            .withBean(AudioJobProcessor.class, () -> mock(AudioJobProcessor.class))
            .withBean(ImageJobProcessor.class, () -> mock(ImageJobProcessor.class))
            .withBean(ImageEnhanceJobProcessor.class, () -> mock(ImageEnhanceJobProcessor.class))
            .withBean(ImageEraseJobProcessor.class, () -> mock(ImageEraseJobProcessor.class))
            .withBean(ImageCutoutJobProcessor.class, () -> mock(ImageCutoutJobProcessor.class))
            .withBean(VideoJobProcessor.class, () -> mock(VideoJobProcessor.class))
            .withBean(WorkerProperties.class, () -> new WorkerProperties(null))
            .withPropertyValues("NEW_API_BASE_URL=http://new-api.invalid");

    @Test
    @DisplayName("ROCKETMQ_ENDPOINTS 缺失 → 启动中止，失败信息点名 ROCKETMQ_ENDPOINTS")
    void missingRocketMqEndpointsAbortsStartup() {
        // rocketmq.endpoints 会从环境变量 ROCKETMQ_ENDPOINTS 解析——本仓 runbook 恰恰要求运维导出它，
        // 显式置空后才与跑测试的 shell 无关（runner 的 MapPropertySource 优先级高于 systemEnvironment），
        // 失败才保证来自 ROCKETMQ_ENDPOINTS 守卫本身。
        mqRunner.withPropertyValues("rocketmq.endpoints=").run(ctx -> {
            Throwable failure = ctx.getStartupFailure();
            assertThat(failure).as("缺 ROCKETMQ_ENDPOINTS 必须中止启动").isNotNull();
            assertThat(chainContains(failure, "ROCKETMQ_ENDPOINTS"))
                    .as("失败信息必须点名 ROCKETMQ_ENDPOINTS（缺配置即失败契约），实际：%s", failure)
                    .isTrue();
        });
    }

    /** DATABASE_URL 经 {@code System.getenv} 读取，只有未设置时才能复现缺失路径。 */
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

    /**
     * 视频 tag 的三处声明必须同值：消费侧订阅（{@link VideoConsumer#TAG}）、
     * 处理器声明（{@link VideoJobProcessor#tag()}）、路由表（{@link GenerationMqRoute#VIDEO}）。
     * 三处错配不会报错，只会让视频消息无人消费——所以在此钉死。
     */
    @Test
    @DisplayName("视频 tag 跨三处一致：VideoConsumer.TAG = VideoJobProcessor.tag() = GenerationMqRoute.VIDEO.tag()")
    void videoTagPinnedAcrossConsumerProcessorAndRoute() {
        VideoJobProcessor processor = new VideoJobProcessor(
                mock(JobStateMachineService.class),
                mock(AssetSourceService.class),
                mock(GenerationCredentialService.class),
                mock(NewApiVideoClient.class),
                mock(TosVideoMediaRelay.class),
                mock(GenerationMessageProducer.class));

        assertThat(VideoConsumer.TAG).isEqualTo("video");
        assertThat(processor.tag()).isEqualTo(VideoConsumer.TAG);
        assertThat(GenerationMqRoute.VIDEO.tag()).isEqualTo(VideoConsumer.TAG);
    }

    /**
     * topic / tag 是契约 §1 的冻结值，{@link GenerationMqRoute} 是其可执行定义：
     * 任何一侧要动都必须在这里显式改，不允许在别处发明字面量。
     */
    @Test
    @DisplayName("GenerationMqRoute 七个入口的 topic / tag 与契约冻结值一致")
    void mqRouteTopicAndTagPinnedToContractValues() {
        Map<GenerationMqRoute, String> expectedTags = Map.of(
                GenerationMqRoute.VIDEO, "video",
                GenerationMqRoute.IMAGE, "image",
                GenerationMqRoute.AUDIO, "audio",
                GenerationMqRoute.MEDIA_EXTRACT, "media_extract",
                GenerationMqRoute.IMAGE_ENHANCE, "image_enhance",
                GenerationMqRoute.IMAGE_ERASE, "image_erase",
                GenerationMqRoute.IMAGE_CUTOUT, "image_cutout");

        assertThat(GenerationMqRoute.values()).hasSize(expectedTags.size());
        for (GenerationMqRoute route : GenerationMqRoute.values()) {
            assertThat(route.topic()).as("%s 的 topic", route).isEqualTo("generation-task");
            assertThat(route.tag()).as("%s 的 tag", route).isEqualTo(expectedTags.get(route));
        }
    }

    /** 枚举的 tag 必须与 {@code generation_jobs.type} 同名（JobType.value()），否则 recovery 会重投到无人订阅的 tag。 */
    @Test
    @DisplayName("GenerationMqRoute.tag() 与 JobType.value() 逐项同值")
    void mqRouteTagsMatchJobTypeValues() {
        assertThat(GenerationMqRoute.VIDEO.tag()).isEqualTo(JobType.VIDEO.value());
        assertThat(GenerationMqRoute.IMAGE.tag()).isEqualTo(JobType.IMAGE.value());
        assertThat(GenerationMqRoute.AUDIO.tag()).isEqualTo(JobType.AUDIO.value());
        assertThat(GenerationMqRoute.MEDIA_EXTRACT.tag()).isEqualTo(JobType.MEDIA_EXTRACT.value());
        assertThat(GenerationMqRoute.IMAGE_ENHANCE.tag()).isEqualTo(JobType.IMAGE_ENHANCE.value());
        assertThat(GenerationMqRoute.IMAGE_ERASE.tag()).isEqualTo(JobType.IMAGE_ERASE.value());
        assertThat(GenerationMqRoute.IMAGE_CUTOUT.tag()).isEqualTo(JobType.IMAGE_CUTOUT.value());
    }

    /**
     * 退役 {@code rocketmq.topic} / {@code rocketmq.tag} 的后果：部署环境里残留的
     * {@code ROCKETMQ_TOPIC} / {@code ROCKETMQ_TAG} 不再有绑定目标——Spring 的宽松绑定忽略未知属性，
     * 既不报错也不生效（路由值只来自 {@link GenerationMqRoute}）。
     * <p>
     * 本用例钉住「属性层」这一半：绑定值只有连接参数，且记录形状里**没有** topic / tag 分量——
     * 谁把它们加回 {@link RocketMqConfig.RocketMqProperties}，这里立刻红。
     * 「不生效」那一半（残留值改不了消费者订阅的 topic / tag）在
     * {@code com.bluewhale.worker.application.consumer.ConsumerRouteWiringTest}：那里能读到
     * package-private 的订阅访问器，且不需要 broker——本类的 runner 一旦真起消费者就会去连
     * {@code rocketmq.endpoints}，无 broker 的机器上必然失败。
     */
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
        // 记录形状即契约：只有连接参数，没有 topic / tag。
        assertThat(RocketMqConfig.RocketMqProperties.class.getRecordComponents())
                .extracting(RecordComponent::getName)
                .containsExactly("endpoints", "accessKey", "secretKey", "sslEnabled");
    }

    /**
     * 走真实 Binder 绑定路径（宽松绑定的未知属性行为只有真绑定才测得准）。
     * 无任何 {@code rocketmq.*} 属性时 Binder 返回空 Optional，此处按 RocketMqConfig 的同构兜底取全空构造。
     */
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
