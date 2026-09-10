package com.bluewhale.worker.config;

import com.bluewhale.worker.messaging.AbstractGenerationConsumer;
import com.bluewhale.worker.messaging.MediaExtractConsumer;
import com.bluewhale.worker.processor.MediaExtractJobProcessor;
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
}
