package com.bluewhale.worker.infrastructure.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
    void parseUrlPreservingQuery() {
        var result = DataSourceConfig.parseDatabaseUrl(
                "mysql://user:pass@localhost:3306/mydb?connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true");
        assertThat(result.jdbcUrl()).isEqualTo(
                "jdbc:mysql://localhost:3306/mydb?connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true");
    }

    @Test
    void parseUrlWithEmptyQuery() {
        var result = DataSourceConfig.parseDatabaseUrl("mysql://user:pass@localhost:3306/mydb?");
        assertThat(result.jdbcUrl()).isEqualTo("jdbc:mysql://localhost:3306/mydb");
    }

    @Test
    void parseUrlPreservingEncodedQuery() {
        var result = DataSourceConfig.parseDatabaseUrl(
                "mysql://user:pass@localhost:3306/mydb?password=a%26b&zeroTimezone=false");
        assertThat(result.jdbcUrl()).isEqualTo(
                "jdbc:mysql://localhost:3306/mydb?password=a%26b&zeroTimezone=false");
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
