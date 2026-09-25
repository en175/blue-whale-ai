package com.bluewhale.billing.config;

import com.bluewhale.billing.application.SettlementService;
import com.bluewhale.billing.infrastructure.mq.JobEventConsumer;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientConfigurationBuilder;
import org.apache.rocketmq.client.apis.StaticSessionCredentialsProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * RocketMQ 客户端的装配（结算 / 返还的消费端）。
 *
 * <p>与 worker 同一套配置键（{@code rocketmq.endpoints/access-key/secret-key/ssl-enabled}），
 * 同一套守卫。两端用同一套键名，部署时不必记两套。
 *
 * <h2>缺 endpoints 为什么直接启动失败</h2>
 *
 * 与 worker 同一立场：MQ 缺配置是**部署错误**，越早炸越好。
 * 若改成「静默跳过消费者」，服务照常起来、Hold 照常工作——但任务跑完之后
 * **没有任何人会结算或解冻**，用户的钱一直冻着，而所有健康检查都是绿的。
 * 这种「起来了一半」比起不来难查得多。
 *
 * <p>本地只想验 Hold、不想起 RocketMQ：设 {@code BILLING_MQ_ENABLED=false} 跳过整个消费者。
 */
@Configuration
@ConditionalOnProperty(name = "billing.mq.enabled", havingValue = "true")
public class RocketMqConfig {

    /** 消费组名。**硬编码而不是从 spring.application.name 推导**——改服务名不该改消费位点。 */
    private static final String CONSUMER_GROUP = "billing-job-event";

    @Bean
    public ClientConfiguration billingRocketMqClientConfiguration(Environment env) {
        RocketMqProperties props = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElseGet(() -> new RocketMqProperties("", "", "", false));

        if (props.endpoints().isBlank()) {
            throw new IllegalStateException("""
                    ROCKETMQ_ENDPOINTS 未配置：结算/返还消费者无法启动。
                      · 需要验结算/返还 → 注入 ROCKETMQ_ENDPOINTS（以及 AK/SK，若集群需要）
                      · 只想在本地验 Hold → 设 BILLING_MQ_ENABLED=false 跳过整个消费者
                    不能「静默跳过」：服务会照常起来、Hold 也照常工作，但任务跑完后
                    没人结算也无人解冻，用户的钱一直冻着，而所有健康检查都是绿的。""");
        }

        ClientConfigurationBuilder builder = ClientConfiguration.newBuilder()
                .setEndpoints(props.endpoints())
                .enableSsl(props.sslEnabled());

        if (!props.accessKey().isBlank() && !props.secretKey().isBlank()) {
            builder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(props.accessKey(), props.secretKey()));
        }
        return builder.build();
    }

    /**
     * ⚠️ 只有 destroyMethod，没有 initMethod：RocketMQ 5 的 {@code PushConsumer}
     * 在 {@code build()} 那一刻就开始拉消息，它没有 {@code start()}。
     * 见 {@link JobEventConsumer} 的类注释。
     */
    @Bean(destroyMethod = "close")
    public JobEventConsumer jobEventConsumer(ClientConfiguration clientConfiguration,
                                             SettlementService settlement,
                                             @Value("${billing.mq.topic-completed:generation-job-completed}")
                                             String completedTopic,
                                             @Value("${billing.mq.topic-failed:generation-job-failed}")
                                             String failedTopic) throws Exception {
        return new JobEventConsumer(clientConfiguration, CONSUMER_GROUP,
                completedTopic, failedTopic, settlement);
    }

    /**
     * @param endpoints  gRPC proxy 端点；空 = 未配置（启动会失败）
     * @param accessKey  集群需要鉴权时配，与 secretKey 同时给才生效
     */
    public record RocketMqProperties(String endpoints, String accessKey,
                                     String secretKey, boolean sslEnabled) {}
}
