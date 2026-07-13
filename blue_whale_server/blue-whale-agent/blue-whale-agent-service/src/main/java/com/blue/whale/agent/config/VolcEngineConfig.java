package com.blue.whale.agent.config;

import com.volcengine.ark.runtime.service.ArkService;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * 火山方舟 Ark 集成配置：绑定 {@code volcengine.ark} 配置段，注册 {@link ArkService} bean（OkHttp 连接池复用）。
 *
 * <p>{@code @ConditionalOnExpression} 仅在 {@code api-key} 非空时创建 ArkService bean——SDK {@code build()}
 * 会校验 key 非空抛 {@code ArkException}，无 key 时跳过 bean 保证裸启动不失败；service 层用
 * {@code ObjectProvider<ArkService>} 懒获取，调用时 absent 抛配置缺失错误。
 * bean 销毁时调 {@link ArkService#shutdownExecutor()} 释放 OkHttp 连接池/Dispatcher。
 */
@Slf4j
@Configuration
@EnableConfigurationProperties(VolcEngineConfig.ArkProperties.class)
public class VolcEngineConfig {

    @Bean(destroyMethod = "shutdownExecutor")
    @ConditionalOnExpression("!'${volcengine.ark.api-key:}'.isEmpty()")
    public ArkService arkService(ArkProperties props) {
        log.info("init ArkService: baseUrl={}", props.getBaseUrl());
        return ArkService.builder()
                .apiKey(props.getApiKey())
                .baseUrl(props.getBaseUrl())
                .timeout(Duration.ofMinutes(10))
                .build();
    }

    /** volcengine.ark 配置段。 */
    @Getter
    @Setter
    @ConfigurationProperties(prefix = "volcengine.ark")
    public static class ArkProperties {
        /** Ark API base url。 */
        private String baseUrl = "https://ark.cn-beijing.volces.com/api/v3";
        /** Ark API key，环境变量 ARK_API_KEY 注入；缺失时不创建 ArkService bean，service 调用时抛配置缺失错误。 */
        private String apiKey;
    }
}
