package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.RunCommitRequest;
import com.blue.whale.agent.model.dto.RunCommitResponse;
import com.blue.whale.agent.model.dto.RunWorkResponse;
import com.blue.whale.agent.model.dto.AssistantMessageStreamRequests;
import com.blue.whale.agent.model.dto.AssistantMessageStreamResponse;
import com.blue.whale.agent.service.AssistantMessageStreamService;
import com.blue.whale.agent.service.AgentRunWorkerService;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequestMapping("/internal/agent-runs")
@RequiredArgsConstructor
public class AgentRunWorkerController {

    private final AgentRunWorkerService workerService;
    private final AssistantMessageStreamService assistantMessageStreamService;

    @PostMapping("/claim")
    public Result<RunWorkResponse> claim(
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestHeader(value = "X-Orchestrator-Engine", required = false) String engine) {
        return Result.ok(workerService.claim(workerId, engine));
    }

    @PostMapping("/{runId}/commits")
    public Result<RunCommitResponse> commit(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestBody @Valid RunCommitRequest request) {
        return Result.ok(workerService.commit(runId, workerId, request));
    }

    @PostMapping("/{runId}/assistant-messages/start")
    public Result<AssistantMessageStreamResponse> startAssistantMessage(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestBody @Valid AssistantMessageStreamRequests.Start request) {
        return Result.ok(assistantMessageStreamService.start(runId, workerId, request));
    }

    @PostMapping("/{runId}/assistant-messages/chunks")
    public Result<AssistantMessageStreamResponse> appendAssistantMessageChunk(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestBody @Valid AssistantMessageStreamRequests.Chunk request) {
        return Result.ok(assistantMessageStreamService.append(runId, workerId, request));
    }

    @PostMapping("/{runId}/assistant-messages/complete")
    public Result<AssistantMessageStreamResponse> completeAssistantMessage(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestBody @Valid AssistantMessageStreamRequests.Complete request) {
        return Result.ok(assistantMessageStreamService.complete(runId, workerId, request));
    }
}
