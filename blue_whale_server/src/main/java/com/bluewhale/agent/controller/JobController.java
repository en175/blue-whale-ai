package com.bluewhale.agent.controller;

import com.bluewhale.agent.common.resp.Result;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.service.GenerationJobService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 任务状态接口：轮询查状态（前端 setInterval 调）、SSE stream 预留、Ark webhook 回调预留。
 *
 * <p>类级不加 {@code @RequestMapping}：三个端点路径前缀不同（{@code /api/jobs} 与 {@code /api/webhooks/ark}），
 * 方法级写全路径更清晰。
 */
@Tag(name = "任务状态接口", description = "轮询查任务状态、SSE 与 webhook 预留")
@RestController
@RequiredArgsConstructor
public class JobController {

    private final GenerationJobService generationJobService;

    /** 轮询查任务状态。 */
    @GetMapping("/api/jobs/{id}")
    public Result<JobStatusResponse> getStatus(@PathVariable("id") Long id) {
        return Result.ok(generationJobService.getJobStatus(id));
    }

    /** SSE 流式推送预留：MVP 用轮询，此端点返 501 指引前端走轮询。 */
    @GetMapping("/api/jobs/{id}/stream")
    public ResponseEntity<Map<String, String>> stream(@PathVariable("id") Long id) {
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .body(Map.of("message", "SSE not implemented, use GET /api/jobs/" + id + " polling"));
    }

    /** Ark 任务回调 webhook 预留：MVP 不依赖回调（poller 主动拉），仅收悉 200。 */
    @PostMapping("/api/webhooks/ark")
    public Result<Map<String, String>> arkCallback(@RequestBody(required = false) Map<String, Object> payload) {
        return Result.ok(Map.of("status", "received"));
    }
}
