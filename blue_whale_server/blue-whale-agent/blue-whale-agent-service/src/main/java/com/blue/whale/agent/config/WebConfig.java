package com.blue.whale.agent.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 配置：放行前端开发域
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    /**
     * 配置跨域：允许前端开发地址访问 /api/** 下的接口。
     * 默认 localhost:3000，可用 env AGENT_CORS_ALLOWED_ORIGINS（逗号分隔）覆盖。
     */
    @Value("${AGENT_CORS_ALLOWED_ORIGINS:http://localhost:3000}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(false)
                .maxAge(3600);
    }
}
