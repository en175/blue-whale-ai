package com.bluewhale.worker.config;

import com.bluewhale.worker.application.consumer.AbstractGenerationConsumer;
import com.bluewhale.worker.application.consumer.AudioConsumer;
import com.bluewhale.worker.application.consumer.ImageConsumer;
import com.bluewhale.worker.application.consumer.ImageEnhanceConsumer;
import com.bluewhale.worker.application.consumer.ImageEraseConsumer;
import com.bluewhale.worker.application.consumer.MediaExtractConsumer;
import com.bluewhale.worker.application.consumer.VideoConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageEraseJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.mq.RocketMqGenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.bluewhale.worker.application.service.AssetSourceService;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientConfigurationBuilder;
import org.apache.rocketmq.client.apis.StaticSessionCredentialsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * RocketMQ 5 客户端配置 + 6 个 consumer bean + 6 个 recovery producer bean。
 * <p>
 * 全部 bean 无条件装配：服务启动即消费全部 tag（ADR-0084 修正六）。
 * 缺 {@code ROCKETMQ_ENDPOINTS} 时 bean 装配直接抛错并终止启动——取代原
 * 「空 enabled-tags → 不连 MQ → 安全拉起 /ready」的形态。
 */
@Configuration
public class RocketMqConfig {

    private static final Logger log = LoggerFactory.getLogger(RocketMqConfig.class);

    /** 「全部留空」的兜底绑定值：只想让缺 {@code ROCKETMQ_ENDPOINTS} 的校验路径先跑起来。 */
    private static final RocketMqProperties DEFAULT_MQ_PROPS =
            new RocketMqProperties("", "", "", false);

    /**
     * RocketMQ 配置属性（绑定 rocketmq.* YAML 前缀）。
     * 环境变量名与 TS worker 逐一对齐（契约 §5）。
     * <p>
     * 只留连接参数：topic / tag **不再是配置项**——它们是契约 §1 的冻结值，单处定义在
     * {@link GenerationMqRoute}。所以部署环境里残留的 {@code ROCKETMQ_TOPIC} /
     * {@code ROCKETMQ_TAG} 不会报错也不会生效（宽松绑定对未知属性无目标可绑，直接忽略）：
     * 这是退役这两个覆盖值的预期后果，不是遗漏。
     */
    public record RocketMqProperties(
            String endpoints,
            String accessKey,
            String secretKey,
            boolean sslEnabled
    ) {
        public RocketMqProperties {
            endpoints = endpoints == null ? "" : endpoints;
            accessKey = accessKey == null ? "" : accessKey;
            secretKey = secretKey == null ? "" : secretKey;
        }
    }

    /**
     * media_extract consumer。
     * <p>
     * consumer group = "generation-extract-worker"（契约 §1）。
     * topic / tag = {@link GenerationMqRoute#MEDIA_EXTRACT}（queue.constants.ts:8）。
     * digitGuard = false（extract 不做纯数字守卫：与 TS rocketmq-extract.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public MediaExtractConsumer mediaExtractConsumer(
            MediaExtractJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：media_extract consumer 无法启动");
        }

        // ClientConfiguration 独立构建（RocketMQ 5.0.7 API）
        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-extract-worker";
        int concurrency = workerProps.concurrency().mediaExtract();

        return new MediaExtractConsumer(
                processor,
                GenerationMqRoute.MEDIA_EXTRACT.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * audio consumer。
     * <p>
     * consumer group = "generation-audio-worker"（契约 §1）。
     * topic / tag = {@link GenerationMqRoute#AUDIO}（queue.constants.ts:2）。
     * digitGuard = true（音频/图片做纯数字守卫，与 TS rocketmq-audio.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public AudioConsumer audioConsumer(
            AudioJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：audio consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-audio-worker";
        int concurrency = workerProps.concurrency().audio();

        return new AudioConsumer(
                processor,
                GenerationMqRoute.AUDIO.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image consumer。
     * <p>
     * consumer group = "generation-image-worker"（契约 §1）。
     * topic / tag = {@link GenerationMqRoute#IMAGE}（queue.constants.ts:5）。
     * digitGuard = true（图片/音频做纯数字守卫，与 TS rocketmq-image.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageConsumer imageConsumer(
            ImageJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：image consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-image-worker";
        int concurrency = workerProps.concurrency().image();

        return new ImageConsumer(
                processor,
                GenerationMqRoute.IMAGE.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image_enhance（高清放大）consumer（契约 §14 / IKGM9D）。
     * <p>
     * consumer group = "generation-image-enhance-worker"（契约 §14.1 冻结值）。
     * topic / tag = {@link GenerationMqRoute#IMAGE_ENHANCE}（契约 §14 / IKGM9D）。
     * digitGuard = true（generation_jobs.id 恒纯数字）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageEnhanceConsumer imageEnhanceConsumer(
            ImageEnhanceJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：image_enhance consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-image-enhance-worker";
        int concurrency = workerProps.concurrency().imageEnhance();

        return new ImageEnhanceConsumer(
                processor,
                GenerationMqRoute.IMAGE_ENHANCE.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image_erase（图片擦除）consumer（契约 §15 / IKGOT6）。
     * <p>
     * consumer group = "generation-image-erase-worker"（契约 §15.1 冻结值）。
     * topic / tag = {@link GenerationMqRoute#IMAGE_ERASE}（契约 §15 / IKGOT6）。
     * digitGuard = true（generation_jobs.id 恒纯数字）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageEraseConsumer imageEraseConsumer(
            ImageEraseJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：image_erase consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-image-erase-worker";
        int concurrency = workerProps.concurrency().imageErase();

        return new ImageEraseConsumer(
                processor,
                GenerationMqRoute.IMAGE_ERASE.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    // ========== 刀④ 视频路径（blade-④ IKEL9A） ==========

    /**
     * MQ 生产者。
     * <p>
     * 视频 processor 自投延迟消息（scheduleNext 5s）到同一 topic/tag。
     * producer 无 consumer group（video-queue.ts:79-98）。
     */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer generationMessageProducer(Environment env) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：video producer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        return RocketMqGenerationMessageProducer.create(
                configBuilder.build(),
                GenerationMqRoute.VIDEO.topic(),
                GenerationMqRoute.VIDEO.tag());
    }

    // ========== recovery 生产者（IKF3AT）：每类 tag 一个 producer，六类全部无条件装配。

    /** recovery 重投 image。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageRecoveryProducer(Environment env) {
        return createProducerForTag(env, GenerationMqRoute.IMAGE);
    }

    /** recovery 重投 audio。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioRecoveryProducer(Environment env) {
        return createProducerForTag(env, GenerationMqRoute.AUDIO);
    }

    /** recovery 重投 media_extract。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer mediaExtractRecoveryProducer(Environment env) {
        return createProducerForTag(env, GenerationMqRoute.MEDIA_EXTRACT);
    }

    /** recovery 重投 image_enhance（契约 §14 / IKGM9D）。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEnhanceRecoveryProducer(Environment env) {
        return createProducerForTag(env, GenerationMqRoute.IMAGE_ENHANCE);
    }

    /** recovery 重投 image_erase（契约 §15 / IKGOT6）。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEraseRecoveryProducer(Environment env) {
        return createProducerForTag(env, GenerationMqRoute.IMAGE_ERASE);
    }

    /** 按路由建 RocketMQ producer（校验与视频生产者同源语义）。 */
    private GenerationMessageProducer createProducerForTag(Environment env, GenerationMqRoute route) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：recovery(" + route.tag() + ") producer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        return RocketMqGenerationMessageProducer.create(
                configBuilder.build(), route.topic(), route.tag());
    }

    /**
     * new-api 视频客户端。
     */
    @Bean
    public NewApiVideoClient newApiVideoClient(Environment env) {
        String baseUrl = env.getProperty("NEW_API_BASE_URL",
                env.getProperty("new-api.base-url", ""));
        return new NewApiVideoClient(baseUrl);
    }

    /**
     * 视频媒体转存。
     * TOS 未配置 → null（VideoJobProcessor 降级直存 URL）。
     */
    @Bean
    public TosVideoMediaRelay tosVideoMediaRelay() {
        return TosVideoMediaRelay.fromEnv();
    }

    /**
     * 视频消费者。
     * <p>
     * consumer group = "generation-video-worker"（契约 §1）。
     * topic / tag = {@link GenerationMqRoute#VIDEO}（tag 与 {@code generation_jobs.type} 同名，
     * 修正六由 "step" 更名）。
     * 顺序消费（无 Semaphore，rocketmq-video.consumer.ts:60-74 for-await each）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public VideoConsumer videoConsumer(
            VideoJobProcessor processor,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：video consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        String consumerGroup = "generation-video-worker";

        return new VideoConsumer(
                processor,
                GenerationMqRoute.VIDEO.topic(),
                configBuilder.build(),
                consumerGroup
        );
    }
}
