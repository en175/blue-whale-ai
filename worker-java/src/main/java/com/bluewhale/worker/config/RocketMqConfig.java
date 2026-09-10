package com.bluewhale.worker.config;

import com.bluewhale.worker.application.consumer.AbstractGenerationConsumer;
import com.bluewhale.worker.application.consumer.AudioConsumer;
import com.bluewhale.worker.application.consumer.ImageConsumer;
import com.bluewhale.worker.application.consumer.MediaExtractConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
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
}
