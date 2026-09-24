package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient.MixAudioTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** audio_mix 独立 MQ 步进：提交、持久化 task_id、查询、转存、发布长期音频 Asset。 */
@Component
public class AudioMixJobProcessor implements JobProcessor {
    private static final Logger log = LoggerFactory.getLogger(AudioMixJobProcessor.class);
    private static final long POLL_INTERVAL_MS = 5_000;
    private static final ScheduledExecutorService LEASE_HEARTBEAT_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread thread = new Thread(r, "amix-lease-heartbeat");
                thread.setDaemon(true);
                return thread;
            });
    private static final Set<String> PRESERVED_CODES = Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    private final JobStateMachineService stateMachine;
    private final GenerationCredentialService credentials;
    private final NewApiMediaKitMixAudioClient gateway;
    private final TosAudioMediaRelay relay;
    private final GenerationMessageProducer producer;
    private final String workerId;
    long leaseRenewIntervalMs = 60_000;

    public AudioMixJobProcessor(JobStateMachineService stateMachine,
                                GenerationCredentialService credentials,
                                NewApiMediaKitMixAudioClient gateway,
                                TosAudioMediaRelay relay,
                                @Qualifier("audioMixMessageProducer") GenerationMessageProducer producer) {
        this.stateMachine = stateMachine;
        this.credentials = credentials;
        this.gateway = gateway;
        this.relay = relay;
        this.producer = producer;
        this.workerId = "amix-" + ProcessHandle.current().pid();
    }

    @Override public String tag() { return AudioMixContract.TAG; }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedMediaExtractJobDto> claimed = stateMachine.claimAudioMix(jobId, workerId);
        if (claimed.isEmpty()) return;
        ClaimedMediaExtractJobDto job = claimed.get();
        try {
            runStep(job);
        } catch (Exception error) {
            String code = error instanceof MediaExtractError domain && PRESERVED_CODES.contains(domain.getCode())
                    ? domain.getCode() : AudioMixContract.ERROR_AUDIO_MIX_FAILED;
            if (!fail(job, code, error.getMessage() != null ? error.getMessage() : "音频混合失败",
                    upstreamHttpStatus(error))) {
                // 守卫未命中表示租约已释放或被其他执行者接管；由到点恢复扫描接续。
                log.info("[audio_mix] 失败守卫未命中，交由恢复扫描 jobId={} token={}", job.id(), job.fencingToken());
            }
        }
    }

    /** 上游 HTTP 状态（网关 !2xx 时经 cause 携带）；非 HTTP 失败返回 null。 */
    private static Integer upstreamHttpStatus(Throwable error) {
        return error.getCause() instanceof NewApiVideoClient.HttpStatusException http
                ? http.getStatus() : null;
    }

    private void runStep(ClaimedMediaExtractJobDto job) {
        if (cancelIfRequested(job)) return;
        Object credential = job.input().get("provider_credential");
        if (!(credential instanceof String frozen) || frozen.isBlank()) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音频混合任务缺少供应商凭证");
            return;
        }
        String token;
        try {
            token = credentials.open(frozen);
        } catch (Exception error) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音频混合任务凭证无效");
            return;
        }
        if (job.providerTaskId() == null) submit(job, token);
        else poll(job, token);
    }

    private void submit(ClaimedMediaExtractJobDto job, String token) {
        Map<String, Object> input = job.input();
        Object formatRaw = input.get(AudioMixContract.INPUT_KEY_OUTPUT_FORMAT);
        if (!(formatRaw instanceof String format) || !AudioMixContract.SUPPORTED_OUTPUT_FORMATS.contains(format)) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音频混合输出格式非法");
            return;
        }
        List<String> urls = frozenUrls(input);
        if (urls == null) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音频混合输入快照非法");
            return;
        }
        String taskId = gateway.submit(token, urls, format);
        if (cancelIfRequested(job)) return;
        if (stateMachine.markProviderSubmitted(job.id(), job.workerId(), job.fencingToken(), taskId)) {
            producer.enqueue(job.id(), POLL_INTERVAL_MS);
        }
    }

    /** 防御历史脏快照：有序 URL、assetId 唯一、固定源首项身份均须成立。 */
    private static List<String> frozenUrls(Map<String, Object> input) {
        Object raw = input.get(AudioMixContract.INPUT_KEY_INPUTS);
        Object sourceNode = input.get(AudioMixContract.INPUT_KEY_SOURCE_NODE_ID);
        if (!(raw instanceof List<?> values) || values.size() < 2 || values.size() > 100
                || !(sourceNode instanceof String source) || source.isBlank()) return null;
        List<String> urls = new ArrayList<>(values.size());
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < values.size(); i++) {
            if (!(values.get(i) instanceof Map<?, ?> item)) return null;
            Object idRaw = item.get("asset_id");
            Object urlRaw = item.get("url");
            if (!(idRaw instanceof String id) || !id.matches("[1-9][0-9]*") || !ids.add(id)
                    || !(urlRaw instanceof String url) || url.isBlank()) return null;
            if (i == 0 && !source.equals(item.get("node_id"))) return null;
            urls.add(url);
        }
        return urls;
    }

    private void poll(ClaimedMediaExtractJobDto job, String token) {
        MixAudioTaskObservation observed;
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
                fail(job, AudioMixContract.ERROR_AUDIO_MIX_FAILED, "音频混合查询超时");
            } else scheduleNext(job);
            return;
        }
        if ("failed".equals(observed.status())) {
            String message = observed.upstreamMessage() != null && !observed.upstreamMessage().isBlank()
                    ? observed.upstreamMessage() : "音频混合任务失败";
            if (observed.requestId() != null && !message.contains("request_id=")) {
                message += " request_id=" + observed.requestId();
            }
            fail(job, classifyFailure(observed.upstreamCode(), message), message);
            return;
        }
        if (observed.audioUrl() == null || observed.audioUrl().isBlank()
                || observed.durationSec() == null || !Double.isFinite(observed.durationSec())
                || observed.durationSec() < 0) {
            fail(job, AudioMixContract.ERROR_AUDIO_MIX_FAILED, "音频混合任务缺少有效结果或时长"
                    + (observed.requestId() != null ? " request_id=" + observed.requestId() : ""));
            return;
        }
        if (relay == null) {
            fail(job, AudioMixContract.ERROR_AUDIO_MIX_FAILED, "音频转存存储未配置");
            return;
        }
        String format = (String) job.input().get(AudioMixContract.INPUT_KEY_OUTPUT_FORMAT);
        if (cancelIfRequested(job) || !renewLease(job)) return;
        AtomicBoolean lostLease = new AtomicBoolean();
        ScheduledFuture<?> heartbeat = LEASE_HEARTBEAT_SCHEDULER.scheduleAtFixedRate(() -> {
            try {
                if (!lostLease.get() && (cancelIfRequested(job) || !renewLease(job))) lostLease.set(true);
            } catch (Exception error) {
                lostLease.set(true);
                log.warn("[audio_mix] 结果转存续租异常 jobId={}", job.id(), error);
            }
        }, leaseRenewIntervalMs, leaseRenewIntervalMs, TimeUnit.MILLISECONDS);
        TosAudioMediaRelay.StoredAudio stored;
        try {
            stored = relay.persist(observed.audioUrl(), job.userId(), format);
        } catch (MediaExtractError error) {
            if (lostLease.get()) return;
            String requestId = observed.requestId();
            if (requestId == null || requestId.isBlank()) throw error;
            throw new MediaExtractError(error.getCode(), error.getMessage() + " request_id=" + requestId, error);
        } finally {
            heartbeat.cancel(false);
        }
        if (lostLease.get() || cancelIfRequested(job) || !renewLease(job)) return;
        boolean published = stateMachine.publishAudioMixResult(new PublishMediaExtractDto(
                job.id(), job.projectId(), job.userId(), job.workerId(), job.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                observed.durationSec()));
        if (!published) log.warn("[audio_mix] 结果发布守卫未命中 jobId={}", job.id());
    }

    private boolean renewLease(ClaimedMediaExtractJobDto job) {
        return stateMachine.renewAudioMixLease(job.id(), job.workerId(), job.fencingToken());
    }

    private void scheduleNext(ClaimedMediaExtractJobDto job) {
        if (cancelIfRequested(job)) return;
        long delayMs = pollDelayMs(job.pollCount());
        if (stateMachine.rescheduleProviderPoll(job.id(), job.workerId(), job.fencingToken(), job.progress(), delayMs)) {
            producer.enqueue(job.id(), delayMs);
        }
    }

    private boolean cancelIfRequested(ClaimedMediaExtractJobDto job) {
        return stateMachine.cancelAudioMixIfRequested(job.id(), job.workerId(), job.fencingToken());
    }

    private static long pollDelayMs(int pollCount) {
        return Math.min(60_000L, POLL_INTERVAL_MS << Math.min(4, Math.max(0, pollCount / 3)));
    }

    /** 平均 RTF≈1 只作预算依据：已知最长源给四倍处理余量加六小时，至少一天；未知给七天。 */
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
        return AudioMixContract.ERROR_AUDIO_MIX_FAILED;
    }

    private boolean fail(ClaimedMediaExtractJobDto job, String code, String message) {
        return fail(job, code, message, null);
    }

    /** details 落结构化上游 HTTP 状态（IKIHGQ）：backend 401 换凭证判定读它，不依赖文案。 */
    private boolean fail(ClaimedMediaExtractJobDto job, String code, String message, Integer httpStatus) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        if (httpStatus != null) {
            details.put(AudioMixContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        log.warn("[audio_mix] job 失败 jobId={} code={} message={}", job.id(), code, message);
        return stateMachine.failMediaExtractJob(new FailMediaExtractDto(
                job.id(), job.workerId(), job.fencingToken(), code, message, details));
    }
}
