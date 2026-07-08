package com.bluewhale.agent.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC 配置：CORS 放行前端开发源 {@code http://localhost:3000}，对齐原 Python 后端契约。
 *
 * <p>采用 {@link WebMvcConfigurer}（而非 {@code WebMvcConfigurationSupport}），不破坏 Spring Boot 默认自动配置。
 */
@Configuration
public class WebAppConfig implements WebMvcConfigurer {

    private static final String[] ALLOWED_ORIGINS = {"http://localhost:3000"};

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(ALLOWED_ORIGINS)
                .allowedMethods("*")
                .allowedHeaders("*")
                .allowCredentials(true);
    }
}
