package com.bluewhale.worker.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * 数据源配置（契约 §8 / ADR-0084：环境变量名与 TS worker 同名）。
 * <p>
 * 解析 DATABASE_URL（格式：mysql://user:pass@host:port/db）为 JDBC URL，
 * 保持与 TS 侧相同的环境变量名（灰度期一套部署 env 喂两个栈）。
 * <p>
 * 条件创建：仅当 media_extract 启用时创建真实数据源。
 * 未启用时由 {@link StubDataSourceConfig} 提供空实现，应用可安全拉起 /ready。
 */
@Configuration
public class DataSourceConfig {

    @Bean
    @Conditional(MediaExtractEnabledCondition.class)
    public DataSource dataSource() {
        String databaseUrl = System.getenv("DATABASE_URL");
        if (databaseUrl == null || databaseUrl.isBlank()) {
            throw new IllegalStateException("DATABASE_URL environment variable is required");
        }

        JdbcUrl parsed = parseDatabaseUrl(databaseUrl);

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(parsed.jdbcUrl());
        config.setUsername(parsed.username());
        config.setPassword(parsed.password());
        config.setMaximumPoolSize(10); // 保守池大小（契约未指定，按工程惯例）
        config.setConnectionTimeout(30_000);
        config.setIdleTimeout(600_000);
        config.setMaxLifetime(1_800_000);

        return new HikariDataSource(config);
    }

    /**
     * 解析 mysql://user:pass@host:port/db 为 JDBC URL。
     * 支持 URL 编码的用户名/密码（如含特殊字符）。
     */
    public static JdbcUrl parseDatabaseUrl(String databaseUrl) {
        if (!databaseUrl.startsWith("mysql://")) {
            throw new IllegalArgumentException("DATABASE_URL must start with mysql://");
        }

        try {
            // 转换为 URI 可解析格式（mysql:// → http://）
            URI uri = URI.create(databaseUrl.replaceFirst("^mysql://", "http://"));

            String host = uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : 3306;
            String path = uri.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) {
                throw new IllegalArgumentException("DATABASE_URL must include database name");
            }
            String database = path.substring(1); // 去掉前导 /

            String userInfo = uri.getUserInfo();
            if (userInfo == null || userInfo.isEmpty()) {
                throw new IllegalArgumentException("DATABASE_URL must include user:password");
            }

            int colonIdx = userInfo.indexOf(':');
            if (colonIdx < 0) {
                throw new IllegalArgumentException("DATABASE_URL must include user:password");
            }

            String username = URLDecoder.decode(userInfo.substring(0, colonIdx), StandardCharsets.UTF_8);
            String password = URLDecoder.decode(userInfo.substring(colonIdx + 1), StandardCharsets.UTF_8);

            String jdbcUrl = String.format("jdbc:mysql://%s:%d/%s", host, port, database);

            return new JdbcUrl(jdbcUrl, username, password);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to parse DATABASE_URL: " + e.getMessage(), e);
        }
    }

    public record JdbcUrl(String jdbcUrl, String username, String password) {}
}
