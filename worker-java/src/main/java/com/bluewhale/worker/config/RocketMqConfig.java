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
            topic = topic == null || topic.isBlank() ? "generation-task" : topic;
        }
    }

    /**
     * media_extract consumer。
     * <p>
     * consumer group = "generation-extract-worker"（契约 §1）。
     * tag = "media_extract"（queue.constants.ts:8）。
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * audio consumer。
     * <p>
     * consumer group = "generation-audio-worker"（契约 §1）。
     * tag = "audio"（queue.constants.ts:2）。
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image consumer。
     * <p>
     * consumer group = "generation-image-worker"（契约 §1）。
     * tag = "image"（queue.constants.ts:5）。
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image_enhance（高清放大）consumer（契约 §14 / IKGM9D）。
     * <p>
     * consumer group = "generation-image-enhance-worker"（契约 §14.1 冻结值）。
     * tag = "image_enhance"（复用 topic generation-task）。
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup,
                concurrency
        );
    }

    /**
     * image_erase（图片擦除）consumer（契约 §15 / IKGOT6）。
     * <p>
     * consumer group = "generation-image-erase-worker"（契约 §15.1 冻结值）。
     * tag = "image_erase"（复用 topic generation-task）。
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
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
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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

        String tag = env.getProperty("rocketmq.tag", "video");
        return RocketMqGenerationMessageProducer.create(configBuilder.build(), mqProps.topic(), tag);
    }

    // ========== recovery 生产者（IKF3AT）：每类 tag 一个 producer，六类全部无条件装配。

    /** recovery 重投 image。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image");
    }

    /** recovery 重投 audio。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioRecoveryProducer(Environment env) {
        return createProducerForTag(env, "audio");
    }

    /** recovery 重投 media_extract。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer mediaExtractRecoveryProducer(Environment env) {
        return createProducerForTag(env, "media_extract");
    }

    /** recovery 重投 image_enhance（契约 §14 / IKGM9D）。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEnhanceRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image_enhance");
    }

    /** recovery 重投 image_erase（契约 §15 / IKGOT6）。 */
    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEraseRecoveryProducer(Environment env) {
        return createProducerForTag(env, "image_erase");
    }

    /** 按 tag 建 RocketMQ producer（校验与视频生产者同源语义）。 */
    private GenerationMessageProducer createProducerForTag(Environment env, String tag) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
     * tag = "video"（queue.constants.ts:11）。
     * 顺序消费（无 Semaphore，rocketmq-video.consumer.ts:60-74 for-await each）。
     */
    @Bean(initMethod = "start", destroyMethod = "stop")
    public VideoConsumer videoConsumer(
            VideoJobProcessor processor,
            WorkerProperties workerProps,
            Environment env
    ) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(new RocketMqProperties("", "", "", false, "generation-task"));

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
                mqProps.topic(),
                configBuilder.build(),
                consumerGroup
        );
    }
}
