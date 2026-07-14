package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
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
    private final AssetMapper assetMapper;
    private final ProjectEventService projectEventService;

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
                .map(j -> new SnapshotResponse.GenerationJobDto(
                        j.getId(), j.getAgentRunId(), j.getActionIdentity(), j.getType(), j.getSource(),
                        j.getInput(), j.getStatus(), j.getProgress(),
                        j.getOutputAssetIds(),
                        outputsByJob.getOrDefault(j.getId(), Collections.emptyList())))
                .toList();
        List<SnapshotResponse.ConversationMessageDto> messageDtos = messages.stream()
                .map(message -> new SnapshotResponse.ConversationMessageDto(
                        message.getId(), message.getConversationId(), message.getAgentRunId(),
                        message.getRole(), message.getContent(), message.getSequenceNo()))
                .toList();
        List<SnapshotResponse.AgentRunDto> runDtos = runs.stream()
                .map(run -> new SnapshotResponse.AgentRunDto(
                        run.getId(), run.getConversationId(), run.getStatus(), run.getStage(),
                        run.getEngine(), run.getEngineVersion(), run.getAdapterSchemaVersion(),
                        run.getCurrentCheckpointId(), run.getVersion()))
                .toList();

        // 批量查 job 引用的 Asset，补产品受控访问地址（防 N+1）
        Map<Long, SnapshotResponse.AssetDto> assetMap = resolveAssets(projectId, jobs, outputsByJob);

        long highWatermark = projectEventService.highWatermark(projectId);
        return new SnapshotResponse(
                project, canvas, messageDtos, runDtos, jobDtos, assetMap, highWatermark);
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
                            output.getSlotIndex(), output.getAssetId()));
        }
        return outputsByJob;
    }

    private Map<Long, SnapshotResponse.AssetDto> resolveAssets(
            Long projectId,
            List<GenerationJob> jobs,
            Map<Long, List<SnapshotResponse.GenerationJobOutputDto>> outputsByJob) {
        Stream<Long> outputAssetIds = outputsByJob.values().stream()
                .flatMap(List::stream)
                .map(SnapshotResponse.GenerationJobOutputDto::assetId);
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
        return "/api/projects/" + projectId + "/assets/" + asset.getId() + "/content";
    }
}
