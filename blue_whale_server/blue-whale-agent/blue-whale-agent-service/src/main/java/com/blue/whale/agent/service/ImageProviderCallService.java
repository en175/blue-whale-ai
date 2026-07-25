package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationProviderTaskMapper;
import com.blue.whale.agent.model.dto.GenerationCancellationCommand;
import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationProviderTask;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.AuditRecordWriter;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.CostReservationSnapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class ImageProviderCallService {

    private static final String PROVIDER = "image-sync";
    private static final String ACCOUNT = "default";
    private static final String NO_CALLBACK = "0".repeat(64);

    private final GenerationJobMapper jobMapper;
    private final GenerationProviderTaskMapper taskMapper;
    private final GenerationResultAcceptanceService acceptanceService;
    private final CostReservationService costReservationService;
    private final AuditRecordWriter auditRecordWriter;

    @Transactional
    public Preparation prepare(GenerationJobClaim claim) {
        GenerationJob job = requireClaimedImageJob(claim);
        CostReservationSnapshot reservation = costReservationService.requireActiveBeforeProvider(
                claim.jobId());
        GenerationProviderTask evidence = taskMapper.selectByJobAndSlotForUpdate(
                claim.jobId(), claim.targetSlotIndex());
        if (evidence == null) {
            if (GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
                acceptanceService.acceptCancellation(new GenerationCancellationCommand(
                        claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                        claim.fencingToken(), claim.leaseOwner()));
                return Preparation.CANCELLED;
            }
            taskMapper.insert(new GenerationProviderTask()
                    .setGenerationJobId(job.getId())
                    .setSlotIndex(claim.targetSlotIndex())
                    .setProvider(PROVIDER)
                    .setAccountId(ACCOUNT)
                    .setSubmissionState(GenerationProviderTask.SUBMISSION_SUBMITTING)
                    .setProviderStatus("started")
                    .setCallbackCapabilityDigest(NO_CALLBACK)
                    .setObserveCount(0));
            LocalDateTime deadline = job.getExecutionDeadlineAt();
            if (deadline == null) {
                deadline = jobMapper.selectCurrentTime().plusMinutes(30);
            }
            if (jobMapper.extendImageCallLease(
                    job.getId(), job.getVersion(), job.getFencingToken(), job.getLeaseOwner(),
                    deadline) != 1) {
                throw conflict();
            }
            auditRecordWriter.appendProviderCallFact(
                    job.getUserId(), job.getProjectId(), job.getId(),
                    "cost_reservation.provider_admission", "allowed", "RESERVATION_ACTIVE",
                    reservation.costRuleVersion());
            return Preparation.CALL;
        }
        LocalDateTime now = jobMapper.selectCurrentTime();
        if (job.getExecutionDeadlineAt() != null
                && !job.getExecutionDeadlineAt().isAfter(now)) {
            acceptanceService.acceptFailure(new GenerationFailureCommand(
                    claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                    claim.fencingToken(), claim.leaseOwner(),
                    "outcome_unknown", "图片生成调用结果无法确认"));
            return Preparation.OUTCOME_UNKNOWN;
        }
        job.setLeaseOwner(null)
                .setLeaseExpiresAt(null)
                .setNextActionAt(job.getExecutionDeadlineAt());
        if (jobMapper.updateById(job) != 1) {
            throw conflict();
        }
        return Preparation.WAIT;
    }

    @Transactional
    public void recordOutcome(GenerationJobClaim claim, String status) {
        GenerationProviderTask evidence = taskMapper.selectByJobAndSlotForUpdate(
                claim.jobId(), claim.targetSlotIndex());
        if (evidence == null || !PROVIDER.equals(evidence.getProvider())) {
            throw conflict();
        }
        evidence.setProviderStatus(status);
        if (taskMapper.updateById(evidence) != 1) {
            throw conflict();
        }
        CostReservationSnapshot reservation = costReservationService.findByJob(claim.jobId())
                .orElseThrow(() -> new IllegalStateException("付费供应商调用缺少成本预留"));
        auditRecordWriter.appendProviderCallFact(
                claim.userId(), claim.projectId(), claim.jobId(),
                "generation_provider.call_outcome",
                "success".equals(status) ? "allowed" : "denied",
                status.toUpperCase(Locale.ROOT),
                reservation.costRuleVersion());
    }

    private GenerationJob requireClaimedImageJob(GenerationJobClaim claim) {
        GenerationJob job = jobMapper.selectForUpdate(claim.jobId());
        boolean sameVersion = job != null && Objects.equals(job.getVersion(), claim.jobVersion());
        boolean cancellationTransition = job != null
                && GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())
                && job.getVersion() != null && claim.jobVersion() != null
                && job.getVersion() == claim.jobVersion() + 1;
        boolean valid = job != null
                && GenerationJob.TYPE_IMAGE.equals(job.getType())
                && (GenerationJob.SOURCE_AGENT_RUN.equals(job.getSource())
                || GenerationJob.SOURCE_BOTTOM_DOCK.equals(job.getSource()))
                && (GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus()))
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

    private GlobalException conflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE,
                "GenerationJob 图片调用证据已变化");
    }

    public enum Preparation {
        CALL,
        WAIT,
        CANCELLED,
        OUTCOME_UNKNOWN
    }
}
