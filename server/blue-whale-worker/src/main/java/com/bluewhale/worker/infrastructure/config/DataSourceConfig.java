package com.bluewhale.worker.infrastructure.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

@Configuration
public class DataSourceConfig {

    @Bean
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
        config.setMaximumPoolSize(20);
        config.setConnectionTimeout(30_000);
        config.setIdleTimeout(600_000);
        config.setMaxLifetime(1_800_000);
        config.setConnectionInitSql("SET time_zone='+08:00'");

        return new HikariDataSource(config);
    }

    public static JdbcUrl parseDatabaseUrl(String databaseUrl) {
        if (!databaseUrl.startsWith("mysql://")) {
            throw new IllegalArgumentException("DATABASE_URL must start with mysql://");
        }

        try {
            URI uri = URI.create(databaseUrl.replaceFirst("^mysql://", "http://"));

            String host = uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : 3306;
            String path = uri.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) {
                throw new IllegalArgumentException("DATABASE_URL must include database name");
            }
            String database = path.substring(1);

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
