package com.blue.whale.user.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 健康检查端点。对齐前端/部署探活契约：{@code GET /health} -> {@code {"status":"UP|DOWN"}}。
 *
 * <p>裸返回，不包裹统一 {@code Result}；不引入 actuator。
 * 在 {@code SecurityConfig} 中显式 {@code permitAll} 放行。
 *
 * <p>IK1WZP：在 gateway/agent 的进程级探针之上叠加 {@code users} 表存在性探针。
 * user-service 通过 {@code spring.sql.init.mode=always} 自跑 {@code schema.sql}（ADR-0037
 * 已知边界 1），端口可达 ≠ schema 就绪——当 users 表缺失或缺列时本端点报 DOWN，
 * compose healthcheck fail-closed，堵住「进程起来、端口可达、但 users 漂移」的假健康。
 */
@RestController
@RequestMapping("/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    /**
     * users 表存在性探针 SQL；引用了业务依赖的列，表不存在或缺列时 MySQL 在解析阶段抛异常。
     * 覆盖验收标准 2「表不存在/缺列 → DOWN」两类漂移。
     */
    private static final String PROBE_SQL = "SELECT id, phone, username, status FROM users LIMIT 1";

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> health() {
        boolean ok = probeUsersTable();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", ok ? "UP" : "DOWN");
        // UP=200，DOWN=503 让 compose healthcheck fail-closed
        return ResponseEntity.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    /**
     * users 表存在性探针：查询能成功执行（表存在 + 列就绪）→ true；表不存在/缺列/连接异常 → false。
     * 用 queryForList 而非 queryForMap：干净环境 users 为空表（schema.sql 只建表不插数据），
     * queryForMap 会因「expected 1, actual 0」误报 DOWN。空表 ≠ schema 漂移，不应判不健康。
     */
    private boolean probeUsersTable() {
        try {
            jdbcTemplate.queryForList(PROBE_SQL);
            return true;
        } catch (Exception e) {
            log.warn("users 表探针失败，user-service 报 DOWN：{}", e.getMessage());
            return false;
        }
    }
}
