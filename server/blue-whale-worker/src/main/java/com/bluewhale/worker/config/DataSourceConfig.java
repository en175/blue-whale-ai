package com.bluewhale.worker.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
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
 * 保持与 TS 侧相同的环境变量名（契约 §8）。
 * <p>
 * 无条件创建真实数据源：启动即要求 DATABASE_URL 齐备，缺配置直接抛错终止启动
 * （ADR-0084 修正六：缺配置即失败，取代原「未启用时退化为空实现」的安全拉起形态）。
 */
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
        config.setMaximumPoolSize(20); // 保守池大小（契约未指定，按工程惯例）
        config.setConnectionTimeout(30_000);
        config.setIdleTimeout(600_000);
        config.setMaxLifetime(1_800_000);
        // 时间口径（IKHJ0Q）：Hikari 对每条新建物理连接执行一次，把会话时区钉到北京时间。
        // 必须与 WorkerClock（Java 侧时刻字面量）以及 Node 侧（db.ts 的 timezone + mariadb adapter 补丁）同批次上线。
        //
        // 为什么用 connectionInitSql 而不是 JDBC URL 参数：
        //   ① parseDatabaseUrl 只取 host/port/path/userInfo，DATABASE_URL 上带的 query 串会被静默丢弃；
        //   ② 改 URL 拼装会打破 DataSourceUrlTest 的三条 jdbcUrl 全等断言；
        //   ③ mysql-connector-j 的 connectionTimeZone 管的是 Timestamp/Instant 换算，而本模块所有时间列
        //      都映射为 LocalDateTime（不经那条路径），真正要生效得靠 forceConnectionTimeZoneToSession，
        //      语义绕且同样要改 URL。
        // 这一条改的是 DB 端求值：NOW()、CURRENT_TIMESTAMP(0)、DDL 的 DEFAULT CURRENT_TIMESTAMP(0)。
        // 库里 DATETIME 列存的是字面量（不做时区换算），所以字面量本身由两侧的写入端负责。
        config.setConnectionInitSql("SET time_zone='+08:00'");

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
