package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class GenerationJobClaimService {

    private static final long IMAGE_LEASE_SECONDS = 30;
    private static final long VIDEO_LEASE_SECONDS = 300;

    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper outputMapper;
    private final ProjectEventService projectEventService;

    @Transactional
    public GenerationJobClaim claim(String workerId) {
        if (workerId == null || workerId.isBlank() || workerId.length() > 128) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "Generation Worker 标识无效");
        }
        GenerationJob job = generationJobMapper.selectNextWorkerJobForUpdate();
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "暂无可认领 GenerationJob");
        }
        LocalDateTime databaseNow = generationJobMapper.selectCurrentTime();
        GenerationJobOutput target = outputMapper.selectNextPendingForUpdate(job.getId());
        if (target == null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && (GenerationJob.STATUS_FAILED.equals(job.getStatus())
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus()))) {
            target = outputMapper.selectFailedForEvidenceForUpdate(job.getId());
        }
        if (target == null) {
            throw conflict();
        }
        long nextFencingToken = job.getFencingToken() == null ? 1L : job.getFencingToken() + 1L;
        String previousStatus = job.getStatus();
        if (GenerationJob.STATUS_QUEUED.equals(previousStatus)) {
            job.setStatus(GenerationJob.STATUS_PROCESSING);
        }
        long leaseSeconds = GenerationJob.TYPE_VIDEO.equals(job.getType())
                ? VIDEO_LEASE_SECONDS : IMAGE_LEASE_SECONDS;
        job
                .setLeaseOwner(workerId)
                .setLeaseExpiresAt(databaseNow.plusSeconds(leaseSeconds))
                .setFencingToken(nextFencingToken);
        if (generationJobMapper.updateById(job) != 1) {
            throw conflict();
        }
        GenerationJob claimed = generationJobMapper.selectById(job.getId());
        if (!Objects.equals(previousStatus, claimed.getStatus())) {
            appendStatusChanged(claimed);
        }
        return new GenerationJobClaim(
                claimed.getId(), target.getSlotIndex(), claimed.getProjectId(), claimed.getUserId(), claimed.getVersion(),
                claimed.getFencingToken(), claimed.getLeaseOwner(), claimed.getInput(), claimed.getType(),
                claimed.getStatus(), claimed.getExecutionDeadlineAt());
    }

    /**
     * 组图模式：返回 Job 当前 pending 槽序号（升序），供 Worker 单次方舟调用回填 N 槽（IK24Q9）。
     */
    public List<Integer> pendingSlotIndexes(Long jobId) {
        return outputMapper.selectPendingSlotIndexesByJob(jobId);
    }

    private void appendStatusChanged(GenerationJob job) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("output_asset_ids", job.getOutputAssetIds());
        projectEventService.appendEvent(job.getProjectId(), EventType.GENERATION_JOB_STATUS_CHANGED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, null, null);
    }

    private GlobalException conflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                "GenerationJob 执行权已变化");
    }
}
