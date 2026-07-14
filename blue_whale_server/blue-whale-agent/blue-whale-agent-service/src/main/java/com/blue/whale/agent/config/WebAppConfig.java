package com.blue.whale.agent.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;
import java.util.List;

/**
 * Web MVC 配置：{@code /assets/**} 静态映射暴露转存资源。
 *
 * <p>采用 {@link WebMvcConfigurer}（而非 {@code WebMvcConfigurationSupport}），不破坏 Spring Boot 默认自动配置。
 *
 * <p>CORS 走 {@link CorsFilter}（Servlet Filter 层，同 user 服务 SecurityConfig 的 corsConfigurationSource 机制）。
 * 不用 {@code addCorsMappings}（MVC Interceptor 层），本环境下 allowedOriginPatterns 运行时不绑定 → 带 Origin 请求 403。
 */
@Configuration
public class WebAppConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 转存资源（视频/图片）落 ./data/assets/，通过 /assets/** 暴露给前端
        String location = "file:" + Paths.get("./data/assets").toAbsolutePath() + "/";
        registry.addResourceHandler("/assets/**")
                .addResourceLocations(location);
    }

    /**
     * CORS 过滤器：Filter 层处理，与 user 服务 SecurityConfig#corsConfigurationSource 一致。
     */
    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("*"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("Authorization"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
