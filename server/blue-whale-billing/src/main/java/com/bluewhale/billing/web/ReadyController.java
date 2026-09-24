package com.bluewhale.billing.web;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 存活探测。**与 worker 的 {@code GET /ready} 路径与形态对齐**（对方在
 * {@code server/blue-whale-worker/.../web/ReadyController.java}）—— 探针约定统一，运维不用记两套。
 *
 * <p>刻意**不引 actuator**：骨架阶段没有 metrics 可暴露，引入只会多个端点与一套探针口径。
 * 等 ADR-0113 的 P2 落地、真有指标要出时再加（届时用 Micrometer + Prometheus 端点）。
 */
@RestController
public class ReadyController {

    @GetMapping("/ready")
    public Map<String, Object> ready() {
        return Map.of("status", "ready");
    }
}
