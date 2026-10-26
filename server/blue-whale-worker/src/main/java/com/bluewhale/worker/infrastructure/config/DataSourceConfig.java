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
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.TimeZone;

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

        HikariDataSource dataSource = new HikariDataSource(config);
        requireClockAgreement(dataSource);
        return dataSource;
    }

    static void requireClockAgreement(HikariDataSource dataSource) {
        int databaseOffsetSeconds;
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(
                     "SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())")) {
            rows.next();
            databaseOffsetSeconds = rows.getInt(1);
        } catch (SQLException e) {
            throw new IllegalStateException("数据库会话时区无法确认，装配期终止", e);
        }

        int jvmOffsetSeconds = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 1000;
        if (databaseOffsetSeconds != jvmOffsetSeconds) {
            throw new IllegalStateException(String.format(
                    "Java 的钟与数据库的钟不是同一个：JVM 默认时区偏移 %d 秒，数据库会话时区偏移 %d 秒。"
                            + "容器必须带 TZ=Asia/Shanghai，DATABASE_URL 必须带 "
                            + "connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true。"
                            + "配错时写库墙钟与 NOW() 判定会错开整小时，租约立刻过期或永不释放，"
                            + "且不会以任何其它形式报错。",
                    jvmOffsetSeconds, databaseOffsetSeconds));
        }
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
            String query = uri.getRawQuery();
            if (query != null && !query.isEmpty()) {
                jdbcUrl = jdbcUrl + "?" + query;
            }

            return new JdbcUrl(jdbcUrl, username, password);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to parse DATABASE_URL: " + e.getMessage(), e);
        }
    }

    public record JdbcUrl(String jdbcUrl, String username, String password) {}
}
