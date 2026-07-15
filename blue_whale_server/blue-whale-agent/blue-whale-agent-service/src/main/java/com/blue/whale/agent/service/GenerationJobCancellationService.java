package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class GenerationJobCancellationService {

    private final ProjectService projectService;
    private final GenerationJobMapper jobMapper;
    private final GenerationJobOutputMapper outputMapper;
    private final ProjectEventService projectEventService;
    private final GenerationResultAcceptanceService acceptanceService;

    @Transactional
    public void cancel(Long projectId, Long jobId, Long userId) {
        projectService.requireOwnedForUpdate(projectId, userId);
        GenerationJob job = jobMapper.selectForUpdate(jobId);
        if (!isOwnedExecutableJob(job, projectId, userId)) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        if (isTerminal(job.getStatus()) || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
            return;
        }
        LocalDateTime now = jobMapper.selectCurrentTime();
        if (GenerationJob.STATUS_QUEUED.equals(job.getStatus())) {
            cancelPendingOutputs(job);
            job.setStatus(GenerationJob.STATUS_CANCELLED)
                    .setProgress(null)
                    .setCancelRequestedAt(now)
                    .setNextActionAt(null);
        } else if (GenerationJob.STATUS_PROCESSING.equals(job.getStatus())) {
            job.setStatus(GenerationJob.STATUS_CANCEL_REQUESTED)
                    .setProgress(null)
                    .setCancelRequestedAt(now)
                    .setNextActionAt(now);
        } else {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, "生成任务当前不可取消");
        }
        if (jobMapper.updateById(job) != 1) {
            throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, "生成任务状态已变化");
        }
        GenerationJob updated = jobMapper.selectById(jobId);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", updated.getId());
        payload.put("status", updated.getStatus());
        payload.put("progress", updated.getProgress());
        payload.put("output_asset_ids", updated.getOutputAssetIds());
        projectEventService.appendEvent(updated.getProjectId(),
                EventType.GENERATION_JOB_STATUS_CHANGED,
                AggregateType.GENERATION_JOB, String.valueOf(updated.getId()), updated.getVersion(),
                payload, null, null);
        acceptanceService.resumePydanticRun(updated);
    }

    private void cancelPendingOutputs(GenerationJob job) {
        for (GenerationJobOutput output : outputMapper.selectByJobForUpdate(job.getId())) {
            if (!GenerationJobOutput.STATUS_PENDING.equals(output.getStatus())) {
                continue;
            }
            output.setStatus(GenerationJobOutput.STATUS_CANCELLED).setError(null);
            if (outputMapper.updateById(output) != 1) {
                throw new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                        "生成任务输出状态已变化");
            }
            GenerationJobOutput updated = outputMapper.selectById(output.getId());
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("job_id", updated.getGenerationJobId());
            payload.put("slot_index", updated.getSlotIndex());
            payload.put("status", updated.getStatus());
            payload.put("asset_id", updated.getAssetId());
            projectEventService.appendEvent(job.getProjectId(),
                    EventType.GENERATION_JOB_OUTPUT_UPDATED,
                    AggregateType.GENERATION_JOB_OUTPUT,
                    updated.getGenerationJobId() + ":" + updated.getSlotIndex(),
                    updated.getVersion(), payload, null, null);
        }
    }

    private boolean isOwnedExecutableJob(
            GenerationJob job,
            Long projectId,
            Long userId) {
        return job != null
                && Objects.equals(projectId, job.getProjectId())
                && Objects.equals(userId, job.getUserId())
                && (GenerationJob.TYPE_IMAGE.equals(job.getType())
                || GenerationJob.TYPE_VIDEO.equals(job.getType()))
                && (GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                || GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource()));
    }

    private boolean isTerminal(String status) {
        return GenerationJob.STATUS_SUCCEEDED.equals(status)
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(status)
                || GenerationJob.STATUS_FAILED.equals(status)
                || GenerationJob.STATUS_CANCELLED.equals(status);
    }
}
