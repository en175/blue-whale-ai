package com.bluewhale.agent.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 健康检查端点。对齐前端/部署探活契约：{@code GET /health} -> {@code {"status":"ok"}}。
 *
 * <p>裸返回，不包裹统一 {@code Result}；不引入 actuator。
 */
@RestController
@RequestMapping("/health")
public class HealthController {

    @GetMapping
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
