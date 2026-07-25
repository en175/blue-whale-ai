package com.blue.whale.agent.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;

/**
 * Web MVC 配置：CORS 放行前端开发源；{@code /assets/**} 静态映射暴露转存资源。
 *
 * <p>采用 {@link WebMvcConfigurer}（而非 {@code WebMvcConfigurationSupport}），不破坏 Spring Boot 默认自动配置。
 * 允许源默认 {@code http://localhost:3000}，可用 env AGENT_CORS_ALLOWED_ORIGINS（逗号分隔）覆盖，
 * 供隔离验收栈等非 3000 端口前端入口使用。
 */
@Configuration
public class WebAppConfig implements WebMvcConfigurer {

    @Value("${AGENT_CORS_ALLOWED_ORIGINS:http://localhost:3000}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("*")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 转存资源（视频/图片）落 ./data/assets/，通过 /assets/** 暴露给前端
        String location = "file:" + Paths.get("./data/assets").toAbsolutePath() + "/";
        registry.addResourceHandler("/assets/**")
                .addResourceLocations(location);
    }
}
