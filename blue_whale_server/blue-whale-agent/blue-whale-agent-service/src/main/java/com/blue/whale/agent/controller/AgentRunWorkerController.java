package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.RunCommitRequest;
import com.blue.whale.agent.model.dto.RunCommitResponse;
import com.blue.whale.agent.model.dto.RunWorkResponse;
import com.blue.whale.agent.model.dto.AssistantMessageStreamRequests;
import com.blue.whale.agent.model.dto.AssistantMessageStreamResponse;
import com.blue.whale.agent.model.dto.AgentAssetResponse;
import com.blue.whale.agent.model.dto.CanvasNodeDetail;
import com.blue.whale.agent.model.dto.CanvasNodesResponse;
import com.blue.whale.agent.model.dto.ConversationHistoryResponse;
import com.blue.whale.agent.model.dto.ConversationSummaryResponse;
import com.blue.whale.agent.model.dto.CreativeSkillResponse;
import com.blue.whale.agent.model.dto.CreativeSkillBodyResponse;
import com.blue.whale.agent.model.dto.CreativeSkillReferenceResourceResponse;
import com.blue.whale.agent.model.dto.GenerationJobStatusResponse;
import com.blue.whale.agent.service.AssistantMessageStreamService;
import com.blue.whale.agent.service.CreativeContextQueryService;
import com.blue.whale.agent.service.AgentRunWorkerService;
import com.blue.whale.agent.service.ConversationQueryService;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/internal/agent-runs")
@RequiredArgsConstructor
public class AgentRunWorkerController {

    private final AgentRunWorkerService workerService;
    private final ConversationQueryService conversationQueryService;
    private final CreativeContextQueryService creativeContextQueryService;
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

    @GetMapping("/{runId}/conversation/history")
    public Result<ConversationHistoryResponse> conversationHistory(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestParam(value = "after", required = false) Integer after,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(conversationQueryService.history(runId, workerId, after, limit));
    }

    @GetMapping("/{runId}/conversation/summary")
    public Result<ConversationSummaryResponse> conversationSummary(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(conversationQueryService.summary(runId, workerId));
    }

    @GetMapping("/{runId}/canvas/nodes")
    public Result<CanvasNodesResponse> listCanvasNodes(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(creativeContextQueryService.listCanvasNodes(runId, workerId, limit));
    }

    @GetMapping("/{runId}/canvas/nodes/{nodeId}")
    public Result<CanvasNodeDetail> readCanvasNode(
            @PathVariable Long runId,
            @PathVariable String nodeId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(creativeContextQueryService.readCanvasNode(runId, workerId, nodeId));
    }

    @GetMapping("/{runId}/assets/{assetId}")
    public Result<AgentAssetResponse> readAsset(
            @PathVariable Long runId,
            @PathVariable Long assetId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(creativeContextQueryService.readAsset(runId, workerId, assetId));
    }

    @GetMapping("/{runId}/generation-jobs/{jobId}/status")
    public Result<GenerationJobStatusResponse> readGenerationJobStatus(
            @PathVariable Long runId,
            @PathVariable Long jobId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(creativeContextQueryService.readGenerationJobStatus(runId, workerId, jobId));
    }

    @GetMapping("/{runId}/creative-skills")
    public Result<List<CreativeSkillResponse>> listCreativeSkills(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(creativeContextQueryService.listCreativeSkills(runId, workerId));
    }

    @GetMapping("/{runId}/creative-skill-body")
    public Result<CreativeSkillBodyResponse> readCreativeSkillBody(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        return Result.ok(creativeContextQueryService.readCreativeSkillBody(runId, workerId));
    }

    @GetMapping("/{runId}/creative-skill-references/**")
    public Result<CreativeSkillReferenceResourceResponse> readCreativeSkillReference(
            @PathVariable Long runId,
            HttpServletRequest request,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId) {
        // resourcePath 为规范化 POSIX 相对路径（含 /）：PathPatternParser 下 {var:.+} 不跨路径段，
        // 故用 /** 捕获多段路径后从 URI 提取（schema ResourcePath 仅 [A-Za-z0-9._-] 与 /，无需 decode）。
        String resourcePath = request.getRequestURI().replaceFirst(
                ".*/creative-skill-references/", "");
        return Result.ok(creativeContextQueryService.readCreativeSkillReference(runId, workerId, resourcePath));
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

    @PostMapping("/{runId}/assistant-messages/abort")
    public Result<AssistantMessageStreamResponse> abortAssistantMessage(
            @PathVariable Long runId,
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @RequestBody @Valid AssistantMessageStreamRequests.Abort request) {
        return Result.ok(assistantMessageStreamService.abort(runId, workerId, request));
    }
}
