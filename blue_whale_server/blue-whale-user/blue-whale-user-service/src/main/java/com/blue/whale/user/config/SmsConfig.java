package com.blue.whale.user.config;

import com.blue.whale.user.sms.ConsoleSmsProvider;
import com.blue.whale.user.sms.SmsProvider;
import com.blue.whale.user.sms.VolcengineProperties;
import com.blue.whale.user.sms.VolcengineSmsProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 短信 Provider 自动装配
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class SmsConfig {

    private final VolcengineProperties volcengineProperties;

    @Bean
    @ConditionalOnProperty(name = "sms.provider", havingValue = "console", matchIfMissing = true)
    public SmsProvider consoleSmsProvider() {
        log.info("短信服务: Console（开发环境，控制台打印）");
        return new ConsoleSmsProvider();
    }

    @Bean
    @ConditionalOnProperty(name = "sms.provider", havingValue = "volcengine")
    public SmsProvider volcengineSmsProvider() {
        log.info("短信服务: 火山引擎");
        return new VolcengineSmsProvider(volcengineProperties.getSms());
    }
}
