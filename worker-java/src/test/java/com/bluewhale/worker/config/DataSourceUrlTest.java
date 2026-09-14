package com.bluewhale.worker.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * DATABASE_URL 解析测试（契约 §8：环境变量名与 TS worker 同名）。
 * <p>
 * 覆盖：基础解析、特殊字符、默认端口、异常路径。
 */
class DataSourceUrlTest {

    @Test
    void parseBasicUrl() {
        var result = DataSourceConfig.parseDatabaseUrl("mysql://user:pass@localhost:3306/mydb");
        assertThat(result.jdbcUrl()).isEqualTo("jdbc:mysql://localhost:3306/mydb");
        assertThat(result.username()).isEqualTo("user");
        assertThat(result.password()).isEqualTo("pass");
    }

    @Test
    void parseUrlWithSpecialChars() {
        // URL 编码的特殊字符（如密码含 @/:）
        var result = DataSourceConfig.parseDatabaseUrl("mysql://user%40host:p%40ss%3Aword@db.example.com:3307/prod_db");
        assertThat(result.jdbcUrl()).isEqualTo("jdbc:mysql://db.example.com:3307/prod_db");
        assertThat(result.username()).isEqualTo("user@host");
        assertThat(result.password()).isEqualTo("p@ss:word");
    }

    @Test
    void parseUrlWithDefaultPort() {
        var result = DataSourceConfig.parseDatabaseUrl("mysql://admin:secret@db.internal/mydb");
        assertThat(result.jdbcUrl()).isEqualTo("jdbc:mysql://db.internal:3306/mydb");
        assertThat(result.username()).isEqualTo("admin");
        assertThat(result.password()).isEqualTo("secret");
    }

    @Test
    void rejectNonMysqlScheme() {
        assertThatThrownBy(() -> DataSourceConfig.parseDatabaseUrl("postgres://user:pass@host/db"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must start with mysql://");
    }

    @Test
    void rejectMissingDatabase() {
        assertThatThrownBy(() -> DataSourceConfig.parseDatabaseUrl("mysql://user:pass@host:3306/"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must include database name");
    }

    @Test
    void rejectMissingCredentials() {
        assertThatThrownBy(() -> DataSourceConfig.parseDatabaseUrl("mysql://host:3306/mydb"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must include user:password");
    }

    @Test
    void rejectMalformedUrl() {
        assertThatThrownBy(() -> DataSourceConfig.parseDatabaseUrl("mysql://user@host/db"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must include user:password");
    }
}
