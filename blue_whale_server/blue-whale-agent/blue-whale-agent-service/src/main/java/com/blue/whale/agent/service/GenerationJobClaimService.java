package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class GenerationJobClaimService {

    private static final long LEASE_SECONDS = 30;

    private final GenerationJobMapper generationJobMapper;
    private final ProjectEventService projectEventService;

    @Transactional
    public GenerationJobClaim claim(String workerId) {
        if (workerId == null || workerId.isBlank() || workerId.length() > 128) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "Generation Worker 标识无效");
        }
        GenerationJob job = generationJobMapper.selectNextImageForUpdate();
        if (job == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "暂无可认领 GenerationJob");
        }
        LocalDateTime databaseNow = generationJobMapper.selectCurrentTime();
        long nextFencingToken = job.getFencingToken() == null ? 1L : job.getFencingToken() + 1L;
        job.setStatus(GenerationJob.STATUS_PROCESSING)
                .setLeaseOwner(workerId)
                .setLeaseExpiresAt(databaseNow.plusSeconds(LEASE_SECONDS))
                .setFencingToken(nextFencingToken);
        if (generationJobMapper.updateById(job) != 1) {
            throw conflict();
        }
        GenerationJob claimed = generationJobMapper.selectById(job.getId());
        appendStatusChanged(claimed);
        return new GenerationJobClaim(
                claimed.getId(), claimed.getProjectId(), claimed.getUserId(), claimed.getVersion(),
                claimed.getFencingToken(), claimed.getLeaseOwner(), claimed.getInput());
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
