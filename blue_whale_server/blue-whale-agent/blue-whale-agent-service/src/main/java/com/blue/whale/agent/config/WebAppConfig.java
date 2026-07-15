package com.blue.whale.agent.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * Web 配置：CORS 过滤器。
 *
 * <p>CORS 走 {@link CorsFilter}（Servlet Filter 层，同 user 服务 SecurityConfig 的 corsConfigurationSource 机制）。
 * 不用 {@code addCorsMappings}（MVC Interceptor 层），本环境下 allowedOriginPatterns 运行时不绑定 → 带 Origin 请求 403。
 *
 * <p>转存资源已统一上 TOS 对象存储（公开读 url），不再本地落盘 / 静态映射（见 asset-oss-storage-pipeline D3）。
 */
@Configuration
public class WebAppConfig {

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
