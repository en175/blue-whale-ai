package com.blue.whale.agent.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 启用 {@link TemplateProperties}（bluewhale.template 配置段）。
 */
@Configuration
@EnableConfigurationProperties(TemplateProperties.class)
public class TemplateConfig {
}
