package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoJobDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobExtraEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class JobClaimService {

    private static final Logger log = LoggerFactory.getLogger(JobClaimService.class);

    private static final int LEASE_SECONDS = 120;

    private static final int IMAGE_LEASE_SECONDS = 420;

    private static final int VIDEO_LEASE_SECONDS = 300;

    private static final List<String> IMAGE_CLAIM_SOURCES =
            List.of("bottom_dock", "plan_apply", "storyboard_preview");

    private static int imageLeaseSeconds() {
        String raw = System.getenv("IMAGE_JOB_LEASE_SECONDS");
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.warn("IMAGE_JOB_LEASE_SECONDS 解析失败，使用默认值: {}", e.getMessage());
            }
        }
        return IMAGE_LEASE_SECONDS;
    }

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final GenerationJobMapper jobMapper;

    private final GenerationJobExtraMapper extraMapper;

    public JobClaimService(GenerationJobMapper jobMapper, GenerationJobExtraMapper extraMapper) {
        this.jobMapper = jobMapper;
        this.extraMapper = extraMapper;
    }

    private Map<String, String> loadExtraTexts(Long jobId) {
        Map<String, String> out = new HashMap<>();
        for (GenerationJobExtraEntity row : extraMapper.findByJobId(jobId)) {
            out.put(row.getExtraKey(), row.getValueText());
        }
        return out;
    }


    public Optional<ClaimedJob> claim(ClaimSpec spec, String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = spec.candidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(spec.leaseSeconds());
        int affected = spec.claimCas(jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[{}] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    spec.type(), jobIdLong, candidate.getFencingToken());
            return Optional.empty();
        }

        return Optional.of(project(candidate, workerId));
    }

    private ClaimedJob project(GenerationJobEntity candidate, String workerId) {
        Map<String, Object> input = parseJson(candidate.getInput());
        return new ClaimedJob(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getType(),
                candidate.getProviderTaskId(),
                candidate.getCancelRequestedAt() != null,
                workerId,
                candidate.getFencingToken() + 1,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0,
                candidate.getGmtCreate(),
                candidate.getExecutionDeadlineAt(),
                projectParentProviderTaskId(candidate));
    }

    public Optional<ClaimedJobDto> claimAudioJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findAudioCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(LEASE_SECONDS);
        int affected = jobMapper.claimAudioCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[audio] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                candidate.getType(),
                input != null ? input : Map.of(),
                candidate.getRetryCount() != null ? candidate.getRetryCount() : 0,
                candidate.getCancelRequestedAt() != null,
                postIncrementToken));
    }

    public Optional<ClaimedJobDto> claimImageJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findCandidateByTypeAndSources(
                jobIdLong, "image", IMAGE_CLAIM_SOURCES);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(imageLeaseSeconds());
        int affected = jobMapper.claimImageCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[image] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());
        return Optional.of(new ClaimedJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                candidate.getType(),
                input != null ? input : Map.of(),
                candidate.getRetryCount() != null ? candidate.getRetryCount() : 0,
                candidate.getCancelRequestedAt() != null,
                postIncrementToken));
    }

    public Optional<ClaimedVideoJobDto> claimVideoJobById(String jobId, String workerId) {
        Long jobIdLong = Long.parseLong(jobId);

        GenerationJobEntity candidate = jobMapper.findVideoCandidate(jobIdLong);
        if (candidate == null) {
            return Optional.empty();
        }

        LocalDateTime leaseExpiresAt = LocalDateTime.now().plusSeconds(VIDEO_LEASE_SECONDS);
        int affected = jobMapper.claimVideoCas(
                jobIdLong, workerId, leaseExpiresAt,
                candidate.getFencingToken(), candidate.getStatus());
        if (affected == 0) {
            log.info("[video] CAS claim 未命中(并发竞争) jobId={} expectedToken={}",
                    jobId, candidate.getFencingToken());
            return Optional.empty();
        }

        long postIncrementToken = candidate.getFencingToken() + 1;
        Map<String, Object> input = parseJson(candidate.getInput());

        String parentProviderTaskId = null;
        if (candidate.getRetryOfJobId() != null) {
            parentProviderTaskId = jobMapper.findProviderTaskId(candidate.getRetryOfJobId());
        }

        String videoStage = loadExtraTexts(candidate.getId()).get("video_stage");
        String sourceSampleProviderTaskId = null;
        if ("final".equals(videoStage) && candidate.getSourceSampleJobId() != null) {
            sourceSampleProviderTaskId = jobMapper.findProviderTaskId(candidate.getSourceSampleJobId());
        }

        return Optional.of(new ClaimedVideoJobDto(
                candidate.getId().toString(),
                candidate.getProjectId() != null ? candidate.getProjectId().toString() : "0",
                candidate.getUserId().toString(),
                input != null ? input : Map.of(),
                candidate.getProviderTaskId(),
                candidate.getCancelRequestedAt() != null,
                workerId,
                postIncrementToken,
                candidate.getPollCount() != null ? candidate.getPollCount() : 0,
                candidate.getProgress() != null ? candidate.getProgress() : 0,
                parentProviderTaskId,
                videoStage,
                sourceSampleProviderTaskId));
    }

    private String projectParentProviderTaskId(GenerationJobEntity candidate) {
        if (candidate.getRetryOfJobId() == null) {
            return null;
        }
        return jobMapper.findProviderTaskId(candidate.getRetryOfJobId());
    }

    Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON_MAPPER.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            log.debug("parseJson 失败(非关键，字段降级为空): {}", e.getMessage());
            return null;
        }
    }
}
