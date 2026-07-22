package com.blue.whale.agent.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.model.dto.JobListItemDto;
import com.blue.whale.agent.model.dto.JobStatusDto;
import com.blue.whale.agent.service.GenerationJobService;
import com.blue.whale.agent.service.JobStreamBus;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletResponse;

/**
 * 任务接口：列表查询（生成流页）、轮询查状态（前端 setInterval 调）、SSE stream 预留。
 *
 * <p>类级不加 {@code @RequestMapping}：方法级写全路径更清晰。
 */
@Tag(name = "任务接口", description = "任务列表查询、轮询查状态、SSE 预留")
@RestController
@RequiredArgsConstructor
public class JobController {

    private final GenerationJobService generationJobService;
    private final JobStreamBus jobStreamBus;

    /** 任务列表（生成流页）：按 type/status/projectId 过滤 + 分页，按创建时间倒序。身份走 X-User-Id 头。 */
    @GetMapping("/api/agent/jobs")
    public Result<Page<JobListItemDto>> listJobs(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam(name = "type", required = false) String type,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "projectId", required = false) Long projectId,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        return Result.ok(generationJobService.listJobs(requireUserId(userId), type, status, projectId, page, size));
    }

    /** 轮询查任务状态。 */
    @GetMapping("/api/agent/jobs/{id}")
    public Result<JobStatusDto> getStatus(@PathVariable("id") Long id) {
        return Result.ok(generationJobService.getJobStatus(id));
    }

    /** SSE 流式推送：客户端原生 EventSource 订阅逐张图。 */
    @GetMapping(value = "/api/agent/jobs/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable("id") Long id, HttpServletResponse response) {
        generationJobService.getJobStatus(id); // 不存在则抛 NOT_FOUND
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        SseEmitter emitter = new SseEmitter(300_000L);
        jobStreamBus.subscribe(id, emitter);
        return emitter;
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
