package com.bluewhale.billing.infrastructure.config;

import com.bluewhale.billing.application.CreditService;
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

@Configuration
@ConditionalOnProperty(name = "billing.mq.enabled", havingValue = "true")
public class RocketMqConfig {

    private static final String CONSUMER_GROUP = "billing-job-event";

    @Bean
    public ClientConfiguration billingRocketMqClientConfiguration(Environment env) {
        RocketMqProperties props = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElseGet(() -> new RocketMqProperties("", "", "", false));

        if (props.endpoints().isBlank()) {
            throw new IllegalStateException("""
                    ROCKETMQ_ENDPOINTS 未配置：失败返还消费者无法启动。
                      · 需要验返还 → 注入 ROCKETMQ_ENDPOINTS（以及 AK/SK，若集群需要）
                      · 只想在本地验扣款 → 设 BILLING_MQ_ENABLED=false 跳过整个消费者
                    不能「静默跳过」：服务会照常起来、扣款也照常工作，但任务失败后
                    没人返还，用户被扣的钱收不回来，而所有健康检查都是绿的。""");
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

    @Bean(destroyMethod = "close")
    public JobEventConsumer jobEventConsumer(ClientConfiguration clientConfiguration,
                                             CreditService credits,
                                             @Value("${billing.mq.topic-failed:generation-job-failed}")
                                             String failedTopic) throws Exception {
        return new JobEventConsumer(clientConfiguration, CONSUMER_GROUP,
                failedTopic, credits);
    }

    public record RocketMqProperties(String endpoints, String accessKey,
                                     String secretKey, boolean sslEnabled) {}
}
