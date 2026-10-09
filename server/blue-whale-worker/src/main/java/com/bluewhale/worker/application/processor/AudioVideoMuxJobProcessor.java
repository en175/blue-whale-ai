package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@Component
public class AudioVideoMuxJobProcessor implements JobProcessor {
    private static final Logger log = LoggerFactory.getLogger(AudioVideoMuxJobProcessor.class);
    private static final long POLL_INTERVAL_MS = 5_000;
    private static final ScheduledExecutorService LEASE_HEARTBEAT_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread thread = new Thread(r, "amux-lease-heartbeat");
                thread.setDaemon(true);
                return thread;
            });
    private static final java.util.Set<String> PRESERVED_CODES = java.util.Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(AudioVideoMuxContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitMuxAudioVideoClient gateway;
    private final TosVideoMediaRelay relay;
    private final GenerationMessageProducer producer;
    private final String workerId;
    long leaseRenewIntervalMs = 60_000;
    int publishSettleProbeAttempts = 3;
    long publishSettleProbeDelayMs = 500;

    public AudioVideoMuxJobProcessor(JobStateMachineService stateMachine,
                                     JobClaimService claimService,
                                     GenerationJobMapper jobMapper,
                                     JobFinalizer finalizer,
                                     UpstreamCredential upstreamCredential,
                                     NewApiMediaKitMuxAudioVideoClient gateway,
                                     TosVideoMediaRelay relay,
                                     @Qualifier("audioVideoMuxMessageProducer") GenerationMessageProducer producer) {
        this.stateMachine = stateMachine;
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                AudioVideoMuxContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.upstreamCredential = upstreamCredential;
        this.gateway = gateway;
        this.relay = relay;
        this.producer = producer;
        this.workerId = "amux-" + ProcessHandle.current().pid();
    }

    @Override public String tag() { return AudioVideoMuxContract.TAG; }

    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimed = claimService.claim(claimSpec, jobId, workerId);
        if (claimed.isEmpty()) return;
        ClaimedJob job = claimed.get();
        try {
            runStep(job);
        } catch (Exception error) {
            String code = error instanceof MediaExtractError domain && PRESERVED_CODES.contains(domain.getCode())
                    ? domain.getCode() : AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED;
            try {
                if (!fail(job, code, error.getMessage() != null ? error.getMessage() : "音视频合成失败")) {
                    log.info("[audio_video_mux] 失败守卫未命中，交由恢复扫描 jobId={} token={}", job.id(), job.fencingToken());
                }
            } catch (Exception failError) {
                log.warn("[audio_video_mux] 失败终态落库未完成，任务收口交由恢复扫描/重投 jobId={} token={} reason={}",
                        job.id(), job.fencingToken(), failError.getMessage());
                throw error;
            }
        }
    }

    private void runStep(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        String token;
        try {
            token = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[audio_video_mux] 生成服务凭证未配置 jobId={}: {}", job.id(), e.getMessage());
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }
        if (job.providerTaskId() == null) submit(job, token);
        else poll(job, token);
    }

    private void submit(ClaimedJob job, String token) {
        FrozenSnapshot snapshot = frozenSnapshot(job.input());
        if (snapshot == null) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音视频合成输入快照非法");
            return;
        }
        String clientToken = AudioVideoMuxContract.clientToken(job.id(), snapshot.submitAttempt());
        String taskId = gateway.submit(token, snapshot.videoUrl(), snapshot.audioUrl(),
                snapshot.isAudioReserve(), snapshot.sync(), clientToken);
        if (cancelIfRequested(job)) return;
        if (stateMachine.markProviderSubmitted(job.id(), job.workerId(), job.fencingToken(), taskId)) {
            producer.enqueue(job.id(), POLL_INTERVAL_MS);
        }
    }

    private static FrozenSnapshot frozenSnapshot(Map<String, Object> input) {
        Object audioRaw = input.get(AudioVideoMuxContract.INPUT_KEY_AUDIO);
        Object videoRaw = input.get(AudioVideoMuxContract.INPUT_KEY_VIDEO);
        if (!(audioRaw instanceof Map<?, ?> audio) || !(videoRaw instanceof Map<?, ?> video)) return null;
        Object audioAsset = audio.get(AudioVideoMuxContract.INPUT_FIELD_ASSET_ID);
        Object audioNode = audio.get(AudioVideoMuxContract.INPUT_FIELD_NODE_ID);
        Object audioUrl = audio.get(AudioVideoMuxContract.INPUT_FIELD_URL);
        Object videoAsset = video.get(AudioVideoMuxContract.INPUT_FIELD_ASSET_ID);
        Object videoUrl = video.get(AudioVideoMuxContract.INPUT_FIELD_URL);
        Object reserveRaw = input.get(AudioVideoMuxContract.INPUT_KEY_IS_AUDIO_RESERVE);
        Object syncRaw = input.get(AudioVideoMuxContract.INPUT_KEY_SYNC);
        Object attemptRaw = input.get(AudioVideoMuxContract.INPUT_KEY_SUBMIT_ATTEMPT);
        if (!(audioAsset instanceof String audioId) || !audioId.matches("[1-9][0-9]*")
                || !(audioNode instanceof String audioNodeId) || audioNodeId.isBlank()
                || !(audioUrl instanceof String audioUrlValue) || audioUrlValue.isBlank()
                || !(videoAsset instanceof String videoId) || !videoId.matches("[1-9][0-9]*")
                || !(videoUrl instanceof String videoUrlValue) || videoUrlValue.isBlank()
                || !(reserveRaw instanceof Boolean reserve)
                || !(syncRaw instanceof String sync) || !AudioVideoMuxContract.SYNC_VALUES.contains(sync)
                || !(attemptRaw instanceof Number attempt) || attempt.longValue() < 1) {
            return null;
        }
        return new FrozenSnapshot(audioUrlValue, videoUrlValue, videoId, reserve, sync, attempt.longValue());
    }

    private record FrozenSnapshot(String audioUrl, String videoUrl, String videoAssetId,
                                  boolean isAudioReserve, String sync, long submitAttempt) {}

    private void poll(ClaimedJob job, String token) {
        MuxAudioVideoTaskObservation observed;
        try {
            observed = gateway.poll(token, job.providerTaskId());
        } catch (MediaExtractError error) {
            if (cancelIfRequested(job)) return;
            if (transientPollError(error) && !timedOut(job)) {
                scheduleNext(job);
                return;
            }
            throw error;
        }
        if (cancelIfRequested(job)) return;
        if ("processing".equals(observed.status())) {
            if (timedOut(job)) {
                fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "音视频合成查询超时");
            } else scheduleNext(job);
            return;
        }
        if ("failed".equals(observed.status())) {
            String message = observed.upstreamMessage() != null && !observed.upstreamMessage().isBlank()
                    ? observed.upstreamMessage() : "音视频合成任务失败";
            if (observed.requestId() != null && !message.contains("request_id=")) {
                message += " request_id=" + observed.requestId();
            }
            fail(job, classifyFailure(observed.upstreamCode(), message), message);
            return;
        }
        if (observed.videoUrl() == null || observed.videoUrl().isBlank()) {
            fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "音视频合成任务缺少有效视频结果"
                    + (observed.requestId() != null ? " request_id=" + observed.requestId() : ""));
            return;
        }
        if (relay == null) {
            fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "视频转存存储未配置");
            return;
        }
        FrozenSnapshot snapshot = frozenSnapshot(job.input());
        if (snapshot == null) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音视频合成输入快照非法");
            return;
        }
        if (cancelIfRequested(job) || !renewLease(job)) return;
        TosVideoMediaRelay.TransferAbortHandle abortHandle = new TosVideoMediaRelay.TransferAbortHandle();
        ScheduledFuture<?> heartbeat = LEASE_HEARTBEAT_SCHEDULER.scheduleAtFixedRate(() -> {
            try {
                if (cancelIfRequested(job)) {
                    abortHandle.abort("音视频合成任务已被用户取消");
                } else if (!renewLease(job)) {
                    abortHandle.abort("音视频合成结果转存期租约未命中（已被接管/终态）");
                }
            } catch (Exception error) {
                abortHandle.abort("音视频合成结果转存续租异常: " + error.getMessage());
                log.warn("[audio_video_mux] 结果转存续租异常 jobId={}", job.id(), error);
            }
        }, leaseRenewIntervalMs, leaseRenewIntervalMs, TimeUnit.MILLISECONDS);
        TosVideoMediaRelay.StoredVideo stored;
        try {
            stored = relay.persistStreaming(observed.videoUrl(), job.userId(),
                    AudioVideoMuxContract.MAX_RESULT_BYTES, abortHandle,
                    job.executionDeadlineAt() == null ? null
                            : job.executionDeadlineAt().toInstant(WorkerClock.BEIJING));
        } catch (TosVideoMediaRelay.TransferAbortedException e) {
            log.warn("[audio_video_mux] 结果转存被中止，本执行者静默退出 jobId={}: {}", job.id(), e.getMessage());
            return;
        } catch (MediaExtractError error) {
            String requestId = observed.requestId();
            if (requestId == null || requestId.isBlank()) throw error;
            throw new MediaExtractError(error.getCode(), error.getMessage() + " request_id=" + requestId, error);
        } finally {
            heartbeat.cancel(false);
        }
        boolean cancelRequested;
        try {
            cancelRequested = abortHandle.aborted() || cancelIfRequested(job);
        } catch (Exception error) {
            discardUnpublishedTransfer(job, stored);
            throw error;
        }
        if (cancelRequested) {
            discardUnpublishedTransfer(job, stored);
            return;
        }
        try {
            if (!renewLease(job)) {
                discardUnpublishedTransfer(job, stored);
                return;
            }
        } catch (Exception error) {
            discardUnpublishedTransfer(job, stored);
            throw error;
        }
        boolean published;
        try {
            published = finalizer.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                    job.id(), job.projectId(), job.userId(), job.workerId(), job.fencingToken(),
                    stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                    observed.durationSec(), observed.resolution(), snapshot.videoAssetId()));
        } catch (Exception error) {
            discardUnpublishedTransfer(job, stored, true);
            throw error;
        }
        if (!published) {
            log.warn("[audio_video_mux] 结果发布守卫未命中 jobId={}", job.id());
            discardUnpublishedTransfer(job, stored);
        }
    }

    private void discardUnpublishedTransfer(ClaimedJob job,
                                            TosVideoMediaRelay.StoredVideo stored) {
        discardUnpublishedTransfer(job, stored, false);
    }

    private void discardUnpublishedTransfer(ClaimedJob job,
                                            TosVideoMediaRelay.StoredVideo stored,
                                            boolean publishOutcomeUncertain) {
        try {
            if (publishOutcomeUncertain) {
                switch (awaitPublishSettledAndUnreferenced(job.id(), stored.storageKey())) {
                    case REFERENCED -> {
                        log.warn("[audio_video_mux] 发布结果不明但对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                                job.id(), stored.storageKey());
                        return;
                    }
                    case UNCONFIRMED -> {
                        logPendingTransferCleanup(job.id(), stored.storageKey(),
                                "发布结果不明：有界重查内可能发布该键的事务仍未结束");
                        return;
                    }
                    case SETTLED_UNREFERENCED -> {                      }
                }
            } else if (finalizer.hasPublishedAsset(job.id(), stored.storageKey())) {
                log.warn("[audio_video_mux] 转存对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                        job.id(), stored.storageKey());
                return;
            }
            relay.deleteUnpublishedObject(stored.storageKey());
        } catch (Exception error) {
            logPendingTransferCleanup(job.id(), stored.storageKey(),
                    "权威状态核实或删除异常: " + error.getMessage());
        }
    }

    private enum UnpublishedTransferCheck {
        REFERENCED,
        SETTLED_UNREFERENCED,
        UNCONFIRMED
    }

    private UnpublishedTransferCheck awaitPublishSettledAndUnreferenced(String jobId, String storageKey) {
        for (int attempt = 1; ; attempt++) {
            if (finalizer.hasInFlightJobWriteTransaction(jobId)) {
                if (attempt >= publishSettleProbeAttempts) return UnpublishedTransferCheck.UNCONFIRMED;
                try {
                    Thread.sleep(publishSettleProbeDelayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("发布落定核实等待被中断", interrupted);
                }
                continue;
            }
            return finalizer.hasPublishedAsset(jobId, storageKey)
                    ? UnpublishedTransferCheck.REFERENCED
                    : UnpublishedTransferCheck.SETTLED_UNREFERENCED;
        }
    }

    private static void logPendingTransferCleanup(String jobId, String storageKey, String reason) {
        log.warn("[audio_video_mux][pending-cleanup] 未发布对象保守保留待处理 jobId={} storageKey={} reason={} resolution=retain-pending",
                jobId, storageKey, reason);
    }

    private boolean renewLease(ClaimedJob job) {
        return stateMachine.renewAudioVideoMuxLease(job.id(), job.workerId(), job.fencingToken());
    }

    private void scheduleNext(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        long delayMs = pollDelayMs(job.pollCount());
        if (stateMachine.rescheduleProviderPoll(job.id(), job.workerId(), job.fencingToken(), job.progress(), delayMs)) {
            producer.enqueue(job.id(), delayMs);
        }
    }

    private boolean cancelIfRequested(ClaimedJob job) {
        return stateMachine.cancelAudioVideoMuxIfRequested(job.id(), job.workerId(), job.fencingToken());
    }

    private static long pollDelayMs(int pollCount) {
        return Math.min(60_000L, POLL_INTERVAL_MS << Math.min(4, Math.max(0, pollCount / 3)));
    }

    private static boolean timedOut(ClaimedJob job) {
        if (job.executionDeadlineAt() != null) {
            return !WorkerClock.now().isBefore(job.executionDeadlineAt());
        }
        if (job.createdAt() == null) return false;
        Object estimated = job.input().get("estimated_duration_ms");
        Duration budget = estimated instanceof Number number && number.longValue() > 0
                ? Duration.ofHours(6).plus(Duration.ofMillis(number.longValue()).multipliedBy(4))
                : Duration.ofDays(7);
        if (budget.compareTo(Duration.ofDays(1)) < 0) budget = Duration.ofDays(1);
        if (budget.compareTo(Duration.ofDays(365)) > 0) budget = Duration.ofDays(365);
        return Duration.between(job.createdAt(), WorkerClock.now()).compareTo(budget) >= 0;
    }

    private static boolean transientPollError(MediaExtractError error) {
        if (GenerationError.ERROR_PROVIDER_TIMEOUT.equals(error.getCode())) return true;
        if (!GenerationError.ERROR_PROVIDER_FAILED.equals(error.getCode())) return false;
        Throwable cause = error.getCause();
        if (cause instanceof ConnectException || cause instanceof UnknownHostException) return true;
        return cause instanceof NewApiVideoClient.HttpStatusException http
                && (http.getStatus() == 429 || http.getStatus() >= 500);
    }

    private static String classifyFailure(String code, String message) {
        String signal = (code == null ? "" : code) + " " + message;
        if (NewApiErrorClassifier.isCopyrightSignal(signal)) return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        if (NewApiErrorClassifier.isContentPolicySignal(signal)) return GenerationError.ERROR_CONTENT_REJECTED;
        if (NewApiErrorClassifier.isQuotaSignal(signal)) return GenerationError.ERROR_QUOTA_EXHAUSTED;
        return AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED;
    }

    private boolean fail(ClaimedJob job, String code, String message) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        log.warn("[audio_video_mux] job 失败 jobId={} code={} message={}", job.id(), code, message);
        FailMediaExtractDto failInput = new FailMediaExtractDto(
                job.id(), job.workerId(), job.fencingToken(), code, message, details);
        return finalizer.failMediaExtractJob(
                failInput.jobId(), failInput.code(), failInput.message(), failInput.details(),
                failInput.workerId(), failInput.fencingToken());
    }
}
