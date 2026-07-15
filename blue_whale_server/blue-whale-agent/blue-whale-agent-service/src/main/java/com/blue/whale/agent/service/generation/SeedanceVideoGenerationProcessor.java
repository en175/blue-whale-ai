package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.dto.VideoGenerationResultCommand;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.SeedanceProviderTaskService;
import com.blue.whale.agent.service.SeedanceProviderTaskService.SubmissionPreparation;
import com.blue.whale.agent.service.governance.CostReservationService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

@Service
@RequiredArgsConstructor
public class SeedanceVideoGenerationProcessor {

    private final SeedanceProviderTaskService taskService;
    private final GenerationResultAcceptanceService acceptanceService;
    private final ObjectProvider<AsyncGenerationProvider> providerProvider;
    private final ObjectProvider<VideoResultIngestor> ingestorProvider;
    private final GenerationAdapterProperties properties;
    private final CostReservationService costReservationService;

    public void process(GenerationJobClaim claim) {
        SubmissionPreparation preparation = taskService.prepare(claim);
        if (preparation.kind() == SubmissionPreparation.Kind.CANCELLED
                || preparation.kind() == SubmissionPreparation.Kind.NO_RESUBMIT) {
            return;
        }
        AsyncGenerationProvider provider = providerProvider.getIfAvailable();
        if (provider == null) {
            throw new IllegalStateException("Seedance Adapter 未配置");
        }
        if (preparation.kind() == SubmissionPreparation.Kind.SUBMIT) {
            costReservationService.requireActiveBeforeProvider(claim.jobId());
            submit(claim, preparation.callbackUrl(), provider);
            return;
        }
        observe(claim, preparation, provider);
    }

    private void submit(
            GenerationJobClaim claim,
            String callbackUrl,
            AsyncGenerationProvider provider) {
        ProviderTaskReference reference;
        try {
            Map<String, Object> input = claim.input();
            reference = provider.submit(new AsyncGenerationSpec(
                    claim.projectId(),
                    claim.userId(),
                    String.valueOf(input.get("prompt")),
                    referenceAssetId(input),
                    String.valueOf(input.get("aspect_ratio")),
                    String.valueOf(input.get("resolution")),
                    number(input.get("duration"), 4),
                    callbackUrl));
        } catch (ProviderSubmissionException exception) {
            taskService.recordSubmissionFailure(claim, exception.isAmbiguous(),
                    exception.getRawCode(), stableRawMessage(exception));
            return;
        } catch (RuntimeException exception) {
            taskService.recordSubmissionFailure(claim, true,
                    "submission_unknown", stableRawMessage(exception));
            return;
        }
        taskService.recordSubmitted(claim, reference);
    }

    private void observe(
            GenerationJobClaim claim,
            SubmissionPreparation preparation,
            AsyncGenerationProvider provider) {
        ProviderObservation observation;
        try {
            observation = provider.observe(preparation.reference());
        } catch (RuntimeException exception) {
            boolean deadlineReached = claim.executionDeadlineAt() != null
                    && !claim.executionDeadlineAt().isAfter(taskService.databaseNow());
            if (deadlineReached && !preparation.evidenceOnly()) {
                taskService.completeFailed(claim, "timed_out", "视频生成超时");
            } else {
                taskService.schedule(claim, nextDelaySeconds(1));
            }
            return;
        }
        int observeCount = taskService.recordObservation(claim, observation);
        if (preparation.evidenceOnly()) {
            if (isTerminal(observation)) {
                costReservationService.settlePendingReconciliation(
                        claim.jobId(), "PROVIDER_EVIDENCE_RECONCILED");
            }
            scheduleEvidenceReconciliation(claim, observeCount);
            return;
        }
        CancellationOutcome cancellationOutcome = preparation.cancelRequested()
                ? CancellationOutcome.USER_CANCELLED
                : CancellationOutcome.PROVIDER_FAILED;
        if (completeFromTerminalObservation(claim, observation, cancellationOutcome)) {
            return;
        }

        boolean deadlineReached = claim.executionDeadlineAt() != null
                && !claim.executionDeadlineAt().isAfter(taskService.databaseNow());
        if (preparation.cancelRequested()
                && provider.cancellationCapability().supports(observation.status())) {
            provider.requestCancel(preparation.reference());
            ProviderObservation confirmed = provider.observe(preparation.reference());
            taskService.recordObservation(claim, confirmed);
            if (completeFromTerminalObservation(
                    claim, confirmed, CancellationOutcome.USER_CANCELLED)) {
                return;
            }
            observation = confirmed;
        }
        if (deadlineReached) {
            if (provider.cancellationCapability().supports(observation.status())) {
                try {
                    provider.requestCancel(preparation.reference());
                    ProviderObservation confirmed = provider.observe(preparation.reference());
                    taskService.recordObservation(claim, confirmed);
                    if (completeFromTerminalObservation(
                            claim, confirmed, CancellationOutcome.IGNORE)) {
                        return;
                    }
                } catch (RuntimeException ignored) {
                    // Product deadline remains authoritative; provider evidence is reconciled later.
                }
            }
            taskService.completeFailed(claim, "timed_out", "视频生成超时");
            return;
        }
        taskService.schedule(claim, nextDelaySeconds(observeCount));
    }

    private boolean completeFromTerminalObservation(
            GenerationJobClaim claim,
            ProviderObservation observation,
            CancellationOutcome cancellationOutcome) {
        if (observation.status() == ProviderObservation.Status.SUCCEEDED) {
            acceptSuccess(claim, observation);
            return true;
        }
        if (observation.status() == ProviderObservation.Status.FAILED) {
            taskService.completeFailed(claim,
                    observation.errorCode() == null ? "provider_failed" : observation.errorCode(),
                    observation.errorMessage() == null ? "视频生成失败" : observation.errorMessage());
            return true;
        }
        if (observation.status() == ProviderObservation.Status.CANCELLED) {
            if (cancellationOutcome == CancellationOutcome.USER_CANCELLED) {
                taskService.completeCancelled(claim);
                return true;
            }
            if (cancellationOutcome == CancellationOutcome.PROVIDER_FAILED) {
                taskService.completeFailed(claim, "provider_cancelled", "视频生成被供应商取消");
                return true;
            }
        }
        return false;
    }

    private enum CancellationOutcome {
        USER_CANCELLED,
        PROVIDER_FAILED,
        IGNORE
    }

    private void acceptSuccess(GenerationJobClaim claim, ProviderObservation observation) {
        VideoResultIngestor ingestor = ingestorProvider.getIfAvailable();
        if (ingestor == null) {
            taskService.completeFailed(claim, "storage_failed", "生成结果存储失败");
            return;
        }
        int expectedDuration = number(claim.input().get("duration"), 4);
        VideoIngestedResult ingested;
        try {
            ingested = ingestor.ingest(claim.jobId(), claim.targetSlotIndex(),
                    observation.temporaryResultUrl(),
                    observation.durationSeconds(), expectedDuration);
        } catch (RuntimeException exception) {
            taskService.completeFailed(claim, "storage_failed", "生成结果存储失败");
            return;
        }
        StoredGenerationObject stored = ingested.stored();
        acceptanceService.acceptVideoSuccess(new VideoGenerationResultCommand(
                claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                claim.fencingToken(), claim.leaseOwner(),
                "job-" + claim.jobId() + "-slot-" + claim.targetSlotIndex(), stored.storageKey(),
                stored.contentSha256(), stored.mimeType(), stored.sizeBytes(),
                ingested.durationSeconds()));
    }

    private void scheduleEvidenceReconciliation(GenerationJobClaim claim, int observeCount) {
        taskService.schedule(claim, nextDelaySeconds(observeCount));
    }

    private boolean isTerminal(ProviderObservation observation) {
        return observation.status() == ProviderObservation.Status.SUCCEEDED
                || observation.status() == ProviderObservation.Status.FAILED
                || observation.status() == ProviderObservation.Status.CANCELLED;
    }

    private int nextDelaySeconds(int observeCount) {
        int initial = properties.getSeedance().getInitialPollSeconds();
        int max = properties.getSeedance().getMaxPollSeconds();
        long exponential = initial * (1L << Math.min(Math.max(0, observeCount - 1), 10));
        int capped = (int) Math.min(max, exponential);
        double jitter = ThreadLocalRandom.current().nextDouble(0.8, 1.2);
        return Math.max(1, (int) Math.round(capped * jitter));
    }

    private Long referenceAssetId(Map<String, Object> input) {
        Object raw = input.get("reference_asset_ids");
        if (!(raw instanceof List<?> values) || values.isEmpty()) {
            return null;
        }
        Object first = values.get(0);
        return first instanceof Number number ? number.longValue() : Long.valueOf(String.valueOf(first));
    }

    private int number(Object value, int fallback) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (RuntimeException exception) {
            return fallback;
        }
    }

    private String stableRawMessage(RuntimeException exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return exception.getClass().getSimpleName();
        }
        return message.length() <= 1000 ? message : message.substring(0, 1000);
    }
}
