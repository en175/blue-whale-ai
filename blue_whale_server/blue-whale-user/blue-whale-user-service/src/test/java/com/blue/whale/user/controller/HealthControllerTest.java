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
 * 覆盖「表正常→UP(200)」「表漂移→DOWN(503)」两条路径。
 */
class HealthControllerTest {

    private static final String PROBE_SQL = "SELECT id, phone, username, status FROM users LIMIT 1";

    @Test
    void upWhenUsersTableQuerySucceeds() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForMap(eq(PROBE_SQL))).thenReturn(Map.of("id", 1));

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
        when(jdbc.queryForMap(eq(PROBE_SQL)))
                .thenThrow(new RuntimeException("Unknown column 'username' in 'field list'"));

        var resp = new HealthController(jdbc).health();

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = resp.getBody();
        assertThat(body).containsEntry("status", "DOWN");
    }
}
