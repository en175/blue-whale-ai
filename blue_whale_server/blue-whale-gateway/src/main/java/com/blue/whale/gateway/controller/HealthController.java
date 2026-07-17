package com.blue.whale.gateway.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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
 */
@RestController
@RequestMapping("/health")
public class HealthController {

    @GetMapping
    public Map<String, String> health() {
        return Map.of("status", "UP");
    }
}
