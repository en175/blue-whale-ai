package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.CreateGenerationJobRequest;
import com.blue.whale.agent.model.dto.CreateGenerationJobResponse;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.service.GenerationJobCommandService;
import com.blue.whale.agent.service.GenerationJobCancellationService;
import com.blue.whale.agent.service.SnapshotService;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/** BottomDock 独立的 Project 级 GenerationJob 命令入口。 */
@RestController
@RequestMapping("/api/projects/{projectId}/generation-jobs")
@RequiredArgsConstructor
public class GenerationJobCommandController {

    private final GenerationJobCommandService commandService;
    private final GenerationJobCancellationService cancellationService;
    private final SnapshotService snapshotService;

    @GetMapping("/{jobId}")
    public Result<SnapshotResponse.GenerationJobDto> get(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("projectId") Long projectId,
            @PathVariable("jobId") Long jobId) {
        return Result.ok(snapshotService.getGenerationJob(
                projectId, jobId, UserContext.requireUserId(userId)));
    }

    @PostMapping
    public ResponseEntity<Result<CreateGenerationJobResponse>> create(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestHeader(value = "X-Input-Request-Id", required = false) Long inputRequestId,
            @PathVariable("projectId") Long projectId,
            @RequestBody @Valid CreateGenerationJobRequest request) {
        CreateGenerationJobResponse accepted = commandService.create(
                projectId, UserContext.requireUserId(userId), idempotencyKey, request,
                inputRequestId);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Result.ok(accepted));
    }

    @PostMapping("/{jobId}/cancel")
    public ResponseEntity<Result<Void>> cancel(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("projectId") Long projectId,
            @PathVariable("jobId") Long jobId) {
        cancellationService.cancel(projectId, jobId, UserContext.requireUserId(userId));
        return ResponseEntity.accepted().body(Result.ok(null));
    }

    @PostMapping("/{jobId}/retry")
    public ResponseEntity<Result<CreateGenerationJobResponse>> retryMissingOutputs(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestHeader(value = "X-Input-Request-Id", required = false) Long inputRequestId,
            @PathVariable("projectId") Long projectId,
            @PathVariable("jobId") Long jobId) {
        CreateGenerationJobResponse accepted = commandService.retryMissingOutputs(
                projectId, jobId, UserContext.requireUserId(userId), idempotencyKey,
                inputRequestId);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Result.ok(accepted));
    }
}
