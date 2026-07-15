package com.blue.whale.agent.service;

import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationProviderTaskMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationProviderTask;
import com.blue.whale.agent.service.generation.GenerationAdapterProperties;
import com.blue.whale.agent.service.generation.ProviderObservation;
import com.blue.whale.agent.service.generation.ProviderTaskReference;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class SeedanceProviderTaskService {

    private static final String PROVIDER = "seedance";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final GenerationJobMapper jobMapper;
    private final GenerationProviderTaskMapper taskMapper;
    private final GenerationResultAcceptanceService acceptanceService;
    private final ProjectEventService projectEventService;
    private final GenerationAdapterProperties properties;

    @Transactional
    public SubmissionPreparation prepare(GenerationJobClaim claim) {
        GenerationJob job = requireClaimedVideoJob(claim);
        GenerationProviderTask existing = taskMapper.selectByJobAndSlotForUpdate(
                job.getId(), claim.targetSlotIndex());
        boolean evidenceOnly = GenerationJob.STATUS_FAILED.equals(job.getStatus())
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(job.getStatus());
        if (existing != null) {
            if (existing.getProviderTaskId() != null && !existing.getProviderTaskId().isBlank()) {
                return SubmissionPreparation.task(reference(existing),
                        GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus()), evidenceOnly);
            }
            if (job.getExecutionDeadlineAt() != null
                    && !job.getExecutionDeadlineAt().isAfter(jobMapper.selectCurrentTime())) {
                acceptFailedSlot(claim, "submission_unknown", "无法确认视频任务是否已提交", true);
                return SubmissionPreparation.cancelled();
            }
            releaseAt(job, job.getExecutionDeadlineAt());
            return SubmissionPreparation.noResubmit();
        }
        if (GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
            complete(job, GenerationJob.STATUS_CANCELLED, null, false);
            return SubmissionPreparation.cancelled();
        }

        byte[] capabilityBytes = new byte[32];
        SECURE_RANDOM.nextBytes(capabilityBytes);
        String capability = Base64.getUrlEncoder().withoutPadding().encodeToString(capabilityBytes);
        String accountId = properties.getSeedance().getAccountId();
        GenerationProviderTask evidence = new GenerationProviderTask()
                .setGenerationJobId(job.getId())
                .setSlotIndex(claim.targetSlotIndex())
                .setProvider(PROVIDER)
                .setAccountId(accountId)
                .setSubmissionState(GenerationProviderTask.SUBMISSION_SUBMITTING)
                .setCallbackCapabilityDigest(Sha256.hex(capability))
                .setObserveCount(0);
        taskMapper.insert(evidence);
        String callbackUrl = normalizedCallbackBaseUrl()
                + "/api/webhooks/seedance/" + accountId + "/" + job.getId()
                + "?capability=" + capability;
        return SubmissionPreparation.submit(callbackUrl);
    }

    @Transactional
    public void recordSubmitted(GenerationJobClaim claim, ProviderTaskReference reference) {
        GenerationJob job = requireClaimedVideoJobAfterSubmission(claim);
        GenerationProviderTask evidence = requireEvidence(job.getId(), claim.targetSlotIndex());
        if (!PROVIDER.equals(reference.providerId())
                || !Objects.equals(evidence.getAccountId(), reference.accountId())
                || reference.taskId() == null || reference.taskId().isBlank()) {
            throw conflict();
        }
        evidence.setProviderTaskId(reference.taskId())
                .setSubmissionState(GenerationProviderTask.SUBMISSION_SUBMITTED)
                .setProviderStatus("queued");
        taskMapper.updateById(evidence);
        LocalDateTime nextAction = jobMapper.selectCurrentTime();
        if (!GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
            nextAction = nextAction.plusSeconds(properties.getSeedance().getInitialPollSeconds());
        }
        releaseAt(job, nextAction);
    }

    @Transactional
    public void recordSubmissionFailure(
            GenerationJobClaim claim,
            boolean ambiguous,
            String rawCode,
            String rawMessage) {
        GenerationJob job = requireClaimedVideoJobAfterSubmission(claim);
        GenerationProviderTask evidence = requireEvidence(job.getId(), claim.targetSlotIndex());
        evidence.setSubmissionState(ambiguous
                        ? GenerationProviderTask.SUBMISSION_UNKNOWN
                        : GenerationProviderTask.SUBMISSION_FAILED)
                .setRawErrorCode(rawCode)
                .setRawErrorMessage(rawMessage);
        taskMapper.updateById(evidence);
        if (ambiguous) {
            releaseAt(job, job.getExecutionDeadlineAt());
        } else if (GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
            complete(job, GenerationJob.STATUS_CANCELLED, null, false);
        } else {
            acceptFailedSlot(claim, "provider_failed", "视频生成提交失败", false);
        }
    }

    @Transactional
    public int recordObservation(GenerationJobClaim claim, ProviderObservation observation) {
        GenerationJob job = requireClaimedVideoJob(claim);
        GenerationProviderTask evidence = requireEvidence(job.getId(), claim.targetSlotIndex());
        int observeCount = evidence.getObserveCount() == null ? 1 : evidence.getObserveCount() + 1;
        evidence.setProviderStatus(observation.status().name().toLowerCase())
                .setRawStatus(observation.rawStatus())
                .setRawErrorCode(observation.rawErrorCode())
                .setRawErrorMessage(observation.rawErrorMessage())
                .setTemporaryResultUrl(observation.temporaryResultUrl())
                .setObserveCount(observeCount);
        taskMapper.updateById(evidence);
        return observeCount;
    }

    @Transactional
    public void schedule(GenerationJobClaim claim, int delaySeconds) {
        GenerationJob job = requireClaimedVideoJob(claim);
        releaseAt(job, jobMapper.selectCurrentTime().plusSeconds(delaySeconds));
    }

    @Transactional
    public void completeCancelled(GenerationJobClaim claim) {
        complete(requireClaimedVideoJob(claim), GenerationJob.STATUS_CANCELLED, null, false);
    }

    @Transactional
    public void completeFailed(GenerationJobClaim claim, String errorCode, String message) {
        requireClaimedVideoJob(claim);
        acceptFailedSlot(claim, errorCode, message, true);
    }

    @Transactional(readOnly = true)
    public LocalDateTime databaseNow() {
        return jobMapper.selectCurrentTime();
    }

    private GenerationJob requireClaimedVideoJob(GenerationJobClaim claim) {
        GenerationJob job = jobMapper.selectForUpdate(claim.jobId());
        boolean valid = job != null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                && Objects.equals(job.getVersion(), claim.jobVersion())
                && Objects.equals(job.getFencingToken(), claim.fencingToken())
                && Objects.equals(job.getLeaseOwner(), claim.leaseOwner())
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(jobMapper.selectCurrentTime());
        if (!valid) {
            throw conflict();
        }
        return job;
    }

    private GenerationJob requireClaimedVideoJobAfterSubmission(GenerationJobClaim claim) {
        GenerationJob job = jobMapper.selectForUpdate(claim.jobId());
        boolean sameVersion = job != null && Objects.equals(job.getVersion(), claim.jobVersion());
        boolean cancellationTransition = job != null
                && GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())
                && job.getVersion() != null
                && claim.jobVersion() != null
                && job.getVersion() == claim.jobVersion() + 1;
        boolean valid = job != null
                && GenerationJob.TYPE_VIDEO.equals(job.getType())
                && GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource())
                && (sameVersion || cancellationTransition)
                && Objects.equals(job.getFencingToken(), claim.fencingToken())
                && Objects.equals(job.getLeaseOwner(), claim.leaseOwner())
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(jobMapper.selectCurrentTime());
        if (!valid) {
            throw conflict();
        }
        return job;
    }

    private GenerationProviderTask requireEvidence(Long jobId, int slotIndex) {
        GenerationProviderTask evidence = taskMapper.selectByJobAndSlotForUpdate(jobId, slotIndex);
        if (evidence == null) {
            throw conflict();
        }
        return evidence;
    }

    private void acceptFailedSlot(
            GenerationJobClaim claim,
            String errorCode,
            String message,
            boolean reconcileEvidence) {
        acceptanceService.acceptFailure(new GenerationFailureCommand(
                claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(), claim.fencingToken(),
                claim.leaseOwner(), errorCode, message));
        GenerationJob failed = jobMapper.selectForUpdate(claim.jobId());
        if (reconcileEvidence
                && (GenerationJob.STATUS_FAILED.equals(failed.getStatus())
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(failed.getStatus()))) {
            failed.setNextActionAt(jobMapper.selectCurrentTime().plusSeconds(
                    properties.getSeedance().getMaxPollSeconds()));
            if (jobMapper.updateById(failed) != 1) {
                throw conflict();
            }
        }
    }

    private ProviderTaskReference reference(GenerationProviderTask evidence) {
        return new ProviderTaskReference(
                evidence.getProvider(), evidence.getAccountId(), evidence.getProviderTaskId());
    }

    private void releaseAt(GenerationJob job, LocalDateTime nextActionAt) {
        job.setNextActionAt(nextActionAt)
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        if (jobMapper.updateById(job) != 1) {
            throw conflict();
        }
    }

    private void complete(
            GenerationJob job,
            String status,
            Map<String, Object> error,
            boolean reconcileEvidence) {
        if (isTerminal(job.getStatus())) {
            return;
        }
        job.setStatus(status)
                .setProgress(null)
                .setError(error)
                .setNextActionAt(GenerationJob.STATUS_FAILED.equals(status) && reconcileEvidence
                        ? jobMapper.selectCurrentTime().plusSeconds(
                        properties.getSeedance().getMaxPollSeconds()) : null)
                .setLeaseOwner(null)
                .setLeaseExpiresAt(null);
        if (jobMapper.updateById(job) != 1) {
            throw conflict();
        }
        appendStatusChanged(jobMapper.selectById(job.getId()));
    }

    private boolean isTerminal(String status) {
        return GenerationJob.STATUS_SUCCEEDED.equals(status)
                || GenerationJob.STATUS_PARTIALLY_SUCCEEDED.equals(status)
                || GenerationJob.STATUS_FAILED.equals(status)
                || GenerationJob.STATUS_CANCELLED.equals(status);
    }

    private void appendStatusChanged(GenerationJob job) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("job_id", job.getId());
        payload.put("status", job.getStatus());
        payload.put("progress", job.getProgress());
        payload.put("output_asset_ids", job.getOutputAssetIds());
        if (job.getError() != null) {
            payload.put("error", job.getError());
        }
        projectEventService.appendEvent(job.getProjectId(), EventType.GENERATION_JOB_STATUS_CHANGED,
                AggregateType.GENERATION_JOB, String.valueOf(job.getId()), job.getVersion(),
                payload, null, null);
    }

    private String normalizedCallbackBaseUrl() {
        String base = properties.getSeedance().getCallbackBaseUrl();
        if (base == null || base.isBlank()) {
            throw new IllegalStateException("缺少 Seedance callback 基础地址");
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    private GlobalException conflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                "GenerationJob 执行权或版本无效");
    }

    public record SubmissionPreparation(
            Kind kind,
            String callbackUrl,
            ProviderTaskReference reference,
            boolean cancelRequested,
            boolean evidenceOnly) {

        public enum Kind { SUBMIT, TASK, NO_RESUBMIT, CANCELLED }

        static SubmissionPreparation submit(String callbackUrl) {
            return new SubmissionPreparation(Kind.SUBMIT, callbackUrl, null, false, false);
        }

        static SubmissionPreparation task(
                ProviderTaskReference reference,
                boolean cancelRequested,
                boolean evidenceOnly) {
            return new SubmissionPreparation(Kind.TASK, null, reference, cancelRequested, evidenceOnly);
        }

        static SubmissionPreparation noResubmit() {
            return new SubmissionPreparation(Kind.NO_RESUBMIT, null, null, false, false);
        }

        static SubmissionPreparation cancelled() {
            return new SubmissionPreparation(Kind.CANCELLED, null, null, false, false);
        }
    }
}
