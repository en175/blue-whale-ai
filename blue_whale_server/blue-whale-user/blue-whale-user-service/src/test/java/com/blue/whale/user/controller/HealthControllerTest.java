package com.blue.whale.user.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * IK1WZP：{@link HealthController} 的 users 表探针单测。
 *
 * <p>不启 Spring Context，直接构造 Controller + mock {@link JdbcTemplate}，
 * 覆盖「表正常→UP(200)」「空表→UP(200)」「表漂移→DOWN(503)」路径。
 */
class HealthControllerTest {

    private static final String PROBE_SQL = "SELECT id, phone, username, status FROM users LIMIT 1";

    @Test
    void upWhenUsersTableHasRow() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(eq(PROBE_SQL))).thenReturn(java.util.List.of(Map.of("id", 1)));

        var resp = new HealthController(jdbc).health();

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = resp.getBody();
        assertThat(body).containsEntry("status", "UP");
    }

    @Test
    void upWhenUsersTableIsEmpty() {
        // 干净环境 users 表存在但无数据（schema.sql 只建表不插数据）。
        // 空表 ≠ schema 漂移，探针查询能成功执行即视为健康（IK1W1K 修复 queryForMap 误报）。
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(eq(PROBE_SQL))).thenReturn(java.util.Collections.emptyList());

        var resp = new HealthController(jdbc).health();

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = resp.getBody();
        assertThat(body).containsEntry("status", "UP");
    }

    @Test
    void downWhenUsersTableMissing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        // 模拟 users 表不存在或缺列（缺列时 MySQL 解析阶段抛 Unknown column）
        when(jdbc.queryForList(eq(PROBE_SQL)))
                .thenThrow(new RuntimeException("Unknown column 'username' in 'field list'"));

        var resp = new HealthController(jdbc).health();

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = resp.getBody();
        assertThat(body).containsEntry("status", "DOWN");
    }
}
