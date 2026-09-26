package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
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
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** audio_video_mux 独立 MQ 步进：提交（sync 档映射 + client_token 幂等键）、持久化 task_id、
 * 查询、视频转存（10 GiB 上限）、发布长期视频 Asset（迁移契约 §20）。 */
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

    private final JobStateMachineService stateMachine;
    private final GenerationCredentialService credentials;
    private final NewApiMediaKitMuxAudioVideoClient gateway;
    private final TosVideoMediaRelay relay;
    private final GenerationMessageProducer producer;
    private final String workerId;
    long leaseRenewIntervalMs = 60_000;

    public AudioVideoMuxJobProcessor(JobStateMachineService stateMachine,
                                     GenerationCredentialService credentials,
                                     NewApiMediaKitMuxAudioVideoClient gateway,
                                     TosVideoMediaRelay relay,
                                     @Qualifier("audioVideoMuxMessageProducer") GenerationMessageProducer producer) {
        this.stateMachine = stateMachine;
        this.credentials = credentials;
        this.gateway = gateway;
        this.relay = relay;
        this.producer = producer;
        this.workerId = "amux-" + ProcessHandle.current().pid();
    }

    @Override public String tag() { return AudioVideoMuxContract.TAG; }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedMediaExtractJobDto> claimed = stateMachine.claimAudioVideoMux(jobId, workerId);
        if (claimed.isEmpty()) return;
        ClaimedMediaExtractJobDto job = claimed.get();
        try {
            runStep(job);
        } catch (Exception error) {
            String code = error instanceof MediaExtractError domain && PRESERVED_CODES.contains(domain.getCode())
                    ? domain.getCode() : AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED;
            if (!fail(job, code, error.getMessage() != null ? error.getMessage() : "音视频合成失败")) {
                // 守卫未命中表示租约已释放或被其他执行者接管；由到点恢复扫描接续。
                log.info("[audio_video_mux] 失败守卫未命中，交由恢复扫描 jobId={} token={}", job.id(), job.fencingToken());
            }
        }
    }

    private void runStep(ClaimedMediaExtractJobDto job) {
        if (cancelIfRequested(job)) return;
        Object credential = job.input().get("provider_credential");
        if (!(credential instanceof String frozen) || frozen.isBlank()) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音视频合成任务缺少供应商凭证");
            return;
        }
        String token;
        try {
            token = credentials.open(frozen);
        } catch (Exception error) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音视频合成任务凭证无效");
            return;
        }
        if (job.providerTaskId() == null) submit(job, token);
        else poll(job, token);
    }

    private void submit(ClaimedMediaExtractJobDto job, String token) {
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

    /** 冻结快照防御校验（迁移契约 §20.2）：audio/video 恒有 assetId+url、audio 必有 nodeId、
     *  is_audio_reserve/sync/submit_attempt 恒显式；sync 三档之外视为脏快照。 */
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

    private void poll(ClaimedMediaExtractJobDto job, String token) {
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
            // 无有效视频结果不假成功；时长/分辨率缺失不失败，回落源资产（迁移契约 §20.4）。
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
        // 转存全程心跳续租 + 失租/取消中止（IKILVH，VideoMatting 同款接线）：下载 + 上传可
        // 远超单次租约窗，心跳保持所有权；取消、续租未命中（已被接管/终态）或续租异常即经
        // 中止句柄停下正在进行的传输——取消与失租共用 abort 通道，原因串区分（取消已落
        // cancelled 终态，失租由接管方/recovery 兜底，本执行者都不再落普通失败终态）。
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
            // 10 GiB 上限保留；时限模型（IKILVH）：停流超时（无进度才计时）+ 任务截止时间
            // （execution_deadline_at 到点中止）+ 容量上限，不再有固定总时限——受控慢流
            // 只要持续有进度且未过截止时间即可完成，供应商临时链接不充当最终产物。
            stored = relay.persistStreaming(observed.videoUrl(), job.userId(),
                    AudioVideoMuxContract.MAX_RESULT_BYTES, abortHandle,
                    job.executionDeadlineAt() == null ? null
                            : job.executionDeadlineAt().toInstant(WorkerClock.BEIJING));
        } catch (TosVideoMediaRelay.TransferAbortedException e) {
            // 中止（取消/失租/续租异常）≠ 普通失败：取消路径已落 cancelled 终态；失租路径
            // failMediaExtractJob 的旧 fencing token 也会被守卫拒绝，任务由新执行者/recovery
            // 继续——均静默退出，不把失租误写成失败终态。
            log.warn("[audio_video_mux] 结果转存被中止，本执行者静默退出 jobId={}: {}", job.id(), e.getMessage());
            return;
        } catch (MediaExtractError error) {
            String requestId = observed.requestId();
            if (requestId == null || requestId.isBlank()) throw error;
            throw new MediaExtractError(error.getCode(), error.getMessage() + " request_id=" + requestId, error);
        } finally {
            heartbeat.cancel(false);
        }
        if (abortHandle.aborted() || cancelIfRequested(job) || !renewLease(job)) return;
        boolean published = stateMachine.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                job.id(), job.projectId(), job.userId(), job.workerId(), job.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                observed.durationSec(), observed.resolution(), snapshot.videoAssetId()));
        if (!published) log.warn("[audio_video_mux] 结果发布守卫未命中 jobId={}", job.id());
    }

    private boolean renewLease(ClaimedMediaExtractJobDto job) {
        return stateMachine.renewAudioVideoMuxLease(job.id(), job.workerId(), job.fencingToken());
    }

    private void scheduleNext(ClaimedMediaExtractJobDto job) {
        if (cancelIfRequested(job)) return;
        long delayMs = pollDelayMs(job.pollCount());
        if (stateMachine.rescheduleProviderPoll(job.id(), job.workerId(), job.fencingToken(), job.progress(), delayMs)) {
            producer.enqueue(job.id(), delayMs);
        }
    }

    private boolean cancelIfRequested(ClaimedMediaExtractJobDto job) {
        return stateMachine.cancelAudioVideoMuxIfRequested(job.id(), job.workerId(), job.fencingToken());
    }

    private static long pollDelayMs(int pollCount) {
        return Math.min(60_000L, POLL_INTERVAL_MS << Math.min(4, Math.max(0, pollCount / 3)));
    }

    /** 超时预算（迁移契约 §20.1）：execution_deadline_at 优先；否则 max(1d, 4×估算+6h)、未知 7d、
     *  上限 365d（本家族把 365d 上限补齐到 worker fallback，消除与 backend 的不对称）。 */
    private static boolean timedOut(ClaimedMediaExtractJobDto job) {
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

    private boolean fail(ClaimedMediaExtractJobDto job, String code, String message) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        log.warn("[audio_video_mux] job 失败 jobId={} code={} message={}", job.id(), code, message);
        return stateMachine.failMediaExtractJob(new FailMediaExtractDto(
                job.id(), job.workerId(), job.fencingToken(), code, message, details));
    }
}
