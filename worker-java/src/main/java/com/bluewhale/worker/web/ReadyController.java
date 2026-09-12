package com.bluewhale.worker.web;

import java.util.Map;

import com.bluewhale.worker.config.WorkerProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 存活探测。TS 版 worker 在 ${GENERATION_WORKER_PORT:4002} 暴露 GET /ready，
 * 此处保持路径与端口对齐（契约健康检查等价）。
 * 返回当前接管的 tag 列表——灰度开关的运维事实源。
 */
@RestController
public class ReadyController {

    private final WorkerProperties props;

    public ReadyController(WorkerProperties props) {
        this.props = props;
    }

    @GetMapping("/ready")
    public Map<String, Object> ready() {
        return Map.of(
                "status", "ready",
                "enabledTags", props.enabledTags(),
                "consumerGroupSuffix", props.groupSuffix());
    }
}
