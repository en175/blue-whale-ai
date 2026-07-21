package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.UserInputRequest;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.CostReservationService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * Project Snapshot 服务（ADR-0016 §2）。
 *
 * <p>恢复入口 {@code GET /api/projects/{projectId}/snapshot}：一致读取 Project、Conversation（首版无）、
 * 当前 GenerationJob、Canvas 对 Asset 的引用，以及 {@code high_watermark_cursor}。
 * 快照状态至少反映到该高水位，客户端随后只需订阅该游标之后的增量（ADR-0017 §3）。
 *
 * <p>归属校验复用 {@link ProjectService#requireOwned}：查不到或越权都抛 RESOURCE_NOT_FOUND，
 * 不泄漏资源是否存在。
 */
@Service
@RequiredArgsConstructor
public class SnapshotService {

    private final ProjectService projectService;
    private final CanvasService canvasService;
    private final ConversationMessageMapper conversationMessageMapper;
    private final AgentRunMapper agentRunMapper;
    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper generationJobOutputMapper;
    private final UserInputRequestMapper userInputRequestMapper;
    private final AssetMapper assetMapper;
    private final ProjectEventService projectEventService;
    private final CostReservationService costReservationService;

    /**
     * 读取 Project 一致快照。
     *
     * @param projectId 项目 ID
     * @param userId    当前用户 ID（用于归属校验）
     * @return 快照响应（含 high_watermark_cursor）
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SnapshotResponse getSnapshot(Long projectId, Long userId) {
        // 归属校验（越权/不存在都不泄漏）
        projectService.requireOwned(projectId, userId);

        ProjectDto project = projectService.get(projectId, userId);
        CanvasDto canvas = canvasService.getByProject(projectId);
        List<ConversationMessage> messages = conversationMessageMapper.selectList(
                Wrappers.<ConversationMessage>lambdaQuery()
                        .eq(ConversationMessage::getProjectId, projectId)
                        .orderByAsc(ConversationMessage::getSequenceNo));
        List<AgentRun> runs = agentRunMapper.selectList(Wrappers.<AgentRun>lambdaQuery()
                .eq(AgentRun::getProjectId, projectId)
                .orderByAsc(AgentRun::getGmtCreate));
        List<GenerationJob> jobs = generationJobMapper.selectList(Wrappers.<GenerationJob>lambdaQuery()
                .eq(GenerationJob::getProjectId, projectId)
                .orderByDesc(GenerationJob::getGmtCreate));

        Map<Long, List<SnapshotResponse.GenerationJobOutputDto>> outputsByJob = resolveOutputs(jobs);
        List<SnapshotResponse.GenerationJobDto> jobDtos = jobs.stream()
                .map(job -> toJobDto(job,
                        outputsByJob.getOrDefault(job.getId(), Collections.emptyList())))
                .toList();
        List<SnapshotResponse.ConversationMessageDto> messageDtos = messages.stream()
                .map(message -> new SnapshotResponse.ConversationMessageDto(
                        message.getId(), message.getConversationId(), message.getAgentRunId(),
                        message.getRole(), message.getContent(), message.getSequenceNo(),
                        message.getStreamId(), message.getStatus(), message.getLastChunkSequence()))
                .toList();
        Map<Long, SnapshotResponse.UserInputRequestDto> activeRequestByRun = resolveActiveInputRequests(projectId, runs);
        List<SnapshotResponse.AgentRunDto> runDtos = runs.stream()
                .map(run -> new SnapshotResponse.AgentRunDto(
                        run.getId(), run.getConversationId(), run.getStatus(), run.getStage(),
                        run.getEngine(), run.getEngineVersion(), run.getAdapterSchemaVersion(),
                        run.getCurrentCheckpointId(), run.getVersion(),
                        activeRequestByRun.get(run.getId())))
                .toList();

        // 批量查 job 引用的 Asset，补产品受控访问地址（防 N+1）
        Map<Long, SnapshotResponse.AssetDto> assetMap = resolveAssets(projectId, jobs, outputsByJob);

        long highWatermark = projectEventService.highWatermark(projectId);
        return new SnapshotResponse(
                project, canvas, messageDtos, runDtos, jobDtos, assetMap, highWatermark);
    }

    @Transactional(readOnly = true)
    public SnapshotResponse.GenerationJobDto getGenerationJob(
            Long projectId,
            Long jobId,
            Long userId) {
        projectService.requireOwned(projectId, userId);
        GenerationJob job = generationJobMapper.selectById(jobId);
        if (job == null || !Objects.equals(job.getProjectId(), projectId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return toJobDto(job, resolveOutputs(List.of(job))
                .getOrDefault(jobId, Collections.emptyList()));
    }

    private SnapshotResponse.GenerationJobDto toJobDto(
            GenerationJob job,
            List<SnapshotResponse.GenerationJobOutputDto> outputs) {
        return new SnapshotResponse.GenerationJobDto(
                job.getId(), job.getAgentRunId(), job.getActionIdentity(),
                job.getExpectedOutputCount(), job.getRetryOfJobId(), job.getType(), job.getSource(),
                job.getInput(), job.getStatus(), job.getProgress(), publicError(job),
                job.getOutputAssetIds(), outputs);
    }

    private Map<Long, List<SnapshotResponse.GenerationJobOutputDto>> resolveOutputs(
            List<GenerationJob> jobs) {
        List<Long> jobIds = jobs.stream().map(GenerationJob::getId).toList();
        if (jobIds.isEmpty()) {
            return Collections.emptyMap();
        }
        Map<Long, List<SnapshotResponse.GenerationJobOutputDto>> outputsByJob = new HashMap<>();
        for (GenerationJobOutput output : generationJobOutputMapper.selectList(
                Wrappers.<GenerationJobOutput>lambdaQuery()
                        .in(GenerationJobOutput::getGenerationJobId, jobIds)
                        .orderByAsc(GenerationJobOutput::getSlotIndex))) {
            outputsByJob.computeIfAbsent(output.getGenerationJobId(), ignored -> new java.util.ArrayList<>())
                    .add(new SnapshotResponse.GenerationJobOutputDto(
                            output.getSlotIndex(), output.getStatus(), output.getAssetId(),
                            GenerationPublicError.project(
                                    output.getError(), jobType(jobs, output.getGenerationJobId()),
                                    budgetEffect(output.getGenerationJobId()))));
        }
        return outputsByJob;
    }

    private Map<Long, SnapshotResponse.AssetDto> resolveAssets(
            Long projectId,
            List<GenerationJob> jobs,
            Map<Long, List<SnapshotResponse.GenerationJobOutputDto>> outputsByJob) {
        Stream<Long> outputAssetIds = outputsByJob.values().stream()
                .flatMap(List::stream)
                .map(SnapshotResponse.GenerationJobOutputDto::assetId)
                .filter(Objects::nonNull);
        Stream<Long> legacyAssetIds = jobs.stream()
                .filter(job -> job.getOutputAssetIds() != null)
                .flatMap(job -> job.getOutputAssetIds().stream());
        List<Long> assetIds = Stream.concat(outputAssetIds, legacyAssetIds)
                .distinct()
                .toList();
        Map<Long, SnapshotResponse.AssetDto> map = new HashMap<>();
        if (assetIds.isEmpty()) {
            return map;
        }
        for (Asset a : assetMapper.selectByIds(assetIds)) {
            if (a.getProjectId() != null && !Objects.equals(a.getProjectId(), projectId)) {
                continue;
            }
            map.put(a.getId(), new SnapshotResponse.AssetDto(
                    a.getId(), assetAccessUrl(projectId, a), a.getType()));
        }
        return map;
    }

    private String assetAccessUrl(Long projectId, Asset asset) {
        if (asset.getProjectId() == null) {
            return asset.getUrl();
        }
        String base = "/api/projects/" + projectId + "/assets/" + asset.getId();
        return Asset.TYPE_VIDEO.equals(asset.getType()) ? base : base + "/content";
    }

    private Map<String, Object> publicError(GenerationJob job) {
        if (!GenerationJob.STATUS_FAILED.equals(job.getStatus())) {
            return null;
        }
        return GenerationPublicError.project(
                job.getError(), job.getType(), budgetEffect(job.getId()));
    }

    private String budgetEffect(Long jobId) {
        return costReservationService.budgetEffect(jobId).wireValue();
    }

    private String jobType(List<GenerationJob> jobs, Long jobId) {
        return jobs.stream()
                .filter(job -> Objects.equals(job.getId(), jobId))
                .map(GenerationJob::getType)
                .findFirst()
                .orElse(GenerationJob.TYPE_IMAGE);
    }

    /**
     * 查询每个非终态 AgentRun 当前的活动 UserInputRequest（ADR-0016 §2）。
     *
     * <p>活动请求通过 source_agent_run_id 关联到创建它的 AgentRun（该 run 处于 awaiting_input）。
     * 一个 AgentRun 至多一个活动请求（pending 或 confirmed），取最近一条。
     */
    private Map<Long, SnapshotResponse.UserInputRequestDto> resolveActiveInputRequests(
            Long projectId,
            List<AgentRun> runs) {
        List<Long> runIds = runs.stream().map(AgentRun::getId).toList();
        if (runIds.isEmpty()) {
            return Collections.emptyMap();
        }
        List<UserInputRequest> active = userInputRequestMapper.selectList(
                Wrappers.<UserInputRequest>lambdaQuery()
                        .eq(UserInputRequest::getProjectId, projectId)
                        .in(UserInputRequest::getSourceAgentRunId, runIds)
                        .in(UserInputRequest::getStatus,
                                UserInputRequest.STATUS_PENDING,
                                UserInputRequest.STATUS_CONFIRMED)
                        .orderByDesc(UserInputRequest::getId));
        Map<Long, SnapshotResponse.UserInputRequestDto> byRun = new HashMap<>();
        for (UserInputRequest request : active) {
            // 同一 AgentRun 至多一个活动请求；按 id desc 取首条，跳过可能的重复。
            byRun.putIfAbsent(request.getSourceAgentRunId(), new SnapshotResponse.UserInputRequestDto(
                    request.getId(), request.getRequestType(), request.getQuestion(),
                    request.getActionIdentity(), request.getActionType(),
                    request.getStatus(), request.getExpiresAt()));
        }
        return byRun;
    }
}
