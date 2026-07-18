package com.blue.whale.gateway.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.PostConstruct;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 健康检查端点。对齐前端/部署探活契约：{@code GET /health} -> {@code {"status":"UP"}}。
 *
 * <p>Spring Cloud Gateway 基于 WebFlux，但 {@code @RestController} 返回同步对象会被
 * Spring 自动适配为响应式。{@code /health} 不以 {@code /api/} 开头，不触发
 * {@code JwtAuthGlobalFilter} 鉴权，无需加白名单。
 *
 * <p>裸返回，不包裹统一 {@code Result}；不引入 actuator。
 * 与 {@code blue-whale-agent-service} 的 {@code HealthController} 契约一致。
 *
 * <p>IK1W1E：附带 build 字段暴露镜像构建身份（源码 commit + 构建时间），
 * 供开发者核对正在运行的镜像是否来自目标 checkout。
 */
@RestController
@RequestMapping("/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    @Value("${GIT_COMMIT:unknown}")
    private String gitCommit;

    @Value("${BUILD_TIME:unknown}")
    private String buildTime;

    @PostConstruct
    void logBuildProvenance() {
        // IK1W1E：启动日志打出构建身份，供 docker logs 核对镜像源码提交
        log.info("Blue-Whale build: commit={} built-at={}", gitCommit, buildTime);
    }

    @GetMapping
    public Map<String, Object> health() {
        Map<String, String> build = new LinkedHashMap<>();
        build.put("commit", gitCommit);
        build.put("builtAt", buildTime);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("build", build);
        return body;
    }
}
