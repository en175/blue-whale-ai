package com.bluewhale.worker.config;

import com.bluewhale.worker.application.consumer.AbstractGenerationConsumer;
import com.bluewhale.worker.application.consumer.AudioConsumer;
import com.bluewhale.worker.application.consumer.ImageConsumer;
import com.bluewhale.worker.application.consumer.ImageEnhanceConsumer;
import com.bluewhale.worker.application.consumer.MediaExtractConsumer;
import com.bluewhale.worker.application.consumer.VideoConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
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
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * RocketMQ 5 客户端配置 + media_extract consumer bean。
 * <p>
 * 条件创建：仅当 worker.enabled-tags 包含 media_extract 时才建 consumer。
 * 空 enabled-tags → 不连 MQ → 应用安全拉起 /ready（契约：无 MQ env 也能 boot）。
 */
@Configuration
public class RocketMqConfig {

    private static final Logger log = LoggerFactory.getLogger(RocketMqConfig.class);

    /**
     * RocketMQ 配置属性（绑定 rocketmq.* YAML 前缀）。
     * 环境变量名与 TS worker 逐一对齐（契约 §5 / §1）。
     */
    public record RocketMqProperties(
            String endpoints,
            String accessKey,
            String secretKey,
            boolean sslEnabled,
            String topic
    ) {
        public RocketMqProperties {
            endpoints = endpoints == null ? "" : endpoints;
            accessKey = accessKey == null ? "" : accessKey;
            secretKey = secretKey == null ? "" : secretKey;
            topic = topic == null || topic.isBlank() ? "generation-video" : topic;
        }
    }

    /**
     * media_extract consumer（条件：enabled-tags 含 media_extract）。
     * <p>
     * consumer group = "generation-extract-worker" + groupSuffix（契约 §1）。
     * tag = "media_extract"（queue.constants.ts:8）。
     * digitGuard = false（extract 不做纯数字守卫：与 TS rocketmq-extract.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(MediaExtractEnabledCondition.class)
    public MediaExtractConsumer mediaExtractConsumer(
            MediaExtractJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

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

        String consumerGroup = "generation-extract-worker" + workerProps.groupSuffix();
        int concurrency = workerProps.concurrency().mediaExtract();

        return new MediaExtractConsumer(
                processor,
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * audio consumer（条件：enabled-tags 含 audio）。
     * <p>
     * consumer group = "generation-audio-worker" + groupSuffix（契约 §1）。
     * tag = "audio"（queue.constants.ts:2）。
     * digitGuard = true（音频/图片做纯数字守卫，与 TS rocketmq-audio.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(AudioEnabledCondition.class)
    public AudioConsumer audioConsumer(
            AudioJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

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

        String consumerGroup = "generation-audio-worker" + workerProps.groupSuffix();
        int concurrency = workerProps.concurrency().audio();

        return new AudioConsumer(
                processor,
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image consumer（条件：enabled-tags 含 image）。
     * <p>
     * consumer group = "generation-image-worker" + groupSuffix（契约 §1）。
     * tag = "image"（queue.constants.ts:5）。
     * digitGuard = true（图片/音频做纯数字守卫，与 TS rocketmq-image.consumer.ts 一致）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(ImageEnabledCondition.class)
    public ImageConsumer imageConsumer(
            ImageJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

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

        String consumerGroup = "generation-image-worker" + workerProps.groupSuffix();
        int concurrency = workerProps.concurrency().image();

        return new ImageConsumer(
                processor,
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image_enhance（高清放大）consumer（条件：enabled-tags 含 image_enhance；契约 §14 / IKGM9D）。
     * <p>
     * consumer group = "generation-image-enhance-worker" + groupSuffix（契约 §14.1 冻结值）。
     * tag = "image_enhance"（复用 topic generation-video）。
     * digitGuard = true（generation_jobs.id 恒纯数字）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(ImageEnhanceEnabledCondition.class)
    public ImageEnhanceConsumer imageEnhanceConsumer(
            ImageEnhanceJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        ConsumerClient mq = createConsumerClientForTag(env, "image_enhance");
        return new ImageEnhanceConsumer(
                processor,
                mq.topic(),
                mq.configuration(),
                "generation-image-enhance-worker" + workerProps.groupSuffix(),
                workerProps.concurrency().imageEnhance()
        );
    }

    /**
     * image_outpaint（智能扩图）consumer（条件：enabled-tags 含 image_outpaint；IKGOQW）。
     * <p>
     * consumer group = "generation-image-outpaint-worker" + groupSuffix。
     * tag = "image_outpaint"（复用 topic generation-video）。
     * digitGuard = true（generation_jobs.id 恒纯数字）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(ImageOutpaintEnabledCondition.class)
    public com.bluewhale.worker.application.consumer.ImageOutpaintConsumer imageOutpaintConsumer(
            com.bluewhale.worker.application.processor.ImageOutpaintJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        ConsumerClient mq = createConsumerClientForTag(env, "image_outpaint");
        return new com.bluewhale.worker.application.consumer.ImageOutpaintConsumer(
                processor,
                mq.topic(),
                mq.configuration(),
                "generation-image-outpaint-worker" + workerProps.groupSuffix(),
                workerProps.concurrency().imageOutpaint()
        );
    }

    /** consumer 侧共享的 MQ 客户端引导产物（topic + ClientConfiguration）。 */
    private record ConsumerClient(String topic, ClientConfiguration configuration) {}

    /**
     * 按 tag 绑定 rocketmq.* 属性并构建 consumer 共享的 MQ 客户端
     * （endpoints 缺失即抛，校验消息含 tag——与 producer 侧 createProducerForTag 同源语义，
     * IKGOQ0 审查修复：收敛 imageEnhance / imageOutpaint 等同形 bean 的逐字重复构建）。
     */
    private ConsumerClient createConsumerClientForTag(Environment env, String tag) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：" + tag + " consumer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        return new ConsumerClient(mqProps.topic(), configBuilder.build());
    }

    // ========== 刀④ 视频路径（blade-④ IKEL9A） ==========

    /**
     * MQ 生产者（条件：enabled-tags 含 step）。
     * <p>
     * 视频 processor 自投延迟消息（scheduleNext 5s）到同一 topic/tag。
     * producer 无 consumer group（video-queue.ts:79-98）。
     */
    @Bean(destroyMethod = "close")
    @Conditional(VideoEnabledCondition.class)
    public GenerationMessageProducer generationMessageProducer(
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

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

        String tag = env.getProperty("rocketmq.tag", "step");
        return RocketMqGenerationMessageProducer.create(configBuilder.build(), mqProps.topic(), tag);
    }

    // ========== recovery 生产者（IKF3AT）：tag 与可消费 tag 同源（@Conditional），
    // 未启用的 tag 不建生产者 → RecoveryService 侧 getIfAvailable()=null 直接跳过 = 灰度开关。

    /** recovery 重投 image（条件：enabled-tags 含 image）。 */
    @Bean(destroyMethod = "close")
    @Conditional(ImageEnabledCondition.class)
    public GenerationMessageProducer imageRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image");
    }

    /** recovery 重投 audio（条件：enabled-tags 含 audio）。 */
    @Bean(destroyMethod = "close")
    @Conditional(AudioEnabledCondition.class)
    public GenerationMessageProducer audioRecoveryProducer(Environment env) {
        return createProducerForTag(env, "audio");
    }

    /** recovery 重投 media_extract（条件：enabled-tags 含 media_extract）。 */
    @Bean(destroyMethod = "close")
    @Conditional(MediaExtractEnabledCondition.class)
    public GenerationMessageProducer mediaExtractRecoveryProducer(Environment env) {
        return createProducerForTag(env, "media_extract");
    }

    /** recovery 重投 image_enhance（条件：enabled-tags 含 image_enhance；契约 §14 / IKGM9D）。 */
    @Bean(destroyMethod = "close")
    @Conditional(ImageEnhanceEnabledCondition.class)
    public GenerationMessageProducer imageEnhanceRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image_enhance");
    }

    /** recovery 重投 image_outpaint（条件：enabled-tags 含 image_outpaint；IKGOQW）。 */
    @Bean(destroyMethod = "close")
    @Conditional(ImageOutpaintEnabledCondition.class)
    public GenerationMessageProducer imageOutpaintRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image_outpaint");
    }

    /** 按 tag 建 RocketMQ producer（校验与视频生产者同源语义）。 */
    private GenerationMessageProducer createProducerForTag(Environment env, String tag) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：recovery(" + tag + ") producer 无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        return RocketMqGenerationMessageProducer.create(configBuilder.build(), mqProps.topic(), tag);
    }

    /**
     * new-api 视频客户端（条件：enabled-tags 含 step）。
     */
    @Bean
    @Conditional(VideoEnabledCondition.class)
    public NewApiVideoClient newApiVideoClient(Environment env) {
        String baseUrl = env.getProperty("NEW_API_BASE_URL",
                env.getProperty("new-api.base-url", ""));
        return new NewApiVideoClient(baseUrl);
    }

    /**
     * 视频媒体转存（条件：enabled-tags 含 step）。
     * TOS 未配置 → null（VideoJobProcessor 降级直存 URL）。
     */
    @Bean
    @Conditional(VideoEnabledCondition.class)
    public TosVideoMediaRelay tosVideoMediaRelay() {
        return TosVideoMediaRelay.fromEnv();
    }

    /**
     * 视频消费者（条件：enabled-tags 含 step）。
     * <p>
     * consumer group = "generation-video-worker" + groupSuffix（契约 §1）。
     * tag = "step"（queue.constants.ts:11）。
     * 顺序消费（无 Semaphore，rocketmq-video.consumer.ts:60-74 for-await each）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    @Conditional(VideoEnabledCondition.class)
    public VideoConsumer videoConsumer(
            VideoJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-video"));

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

        String consumerGroup = "generation-video-worker" + workerProps.groupSuffix();

        return new VideoConsumer(
                processor,
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup
        );
    }
}
