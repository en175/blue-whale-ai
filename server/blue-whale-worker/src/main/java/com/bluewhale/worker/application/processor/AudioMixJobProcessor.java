package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient.MixAudioTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.time.LocalDateTime;
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

    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(AudioMixContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobClaimService claimService;
    private final JobFinalizer finalizer;
    private final ClaimSpec claimSpec;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitMixAudioClient gateway;
    private final TosAudioMediaRelay relay;
    private final GenerationMessageProducer producer;
    private final String workerId;
    long leaseRenewIntervalMs = 60_000;

    public AudioMixJobProcessor(JobStateMachineService stateMachine,
                                JobClaimService claimService,
                                GenerationJobMapper jobMapper,
                                JobFinalizer finalizer,
                                UpstreamCredential upstreamCredential,
                                NewApiMediaKitMixAudioClient gateway,
                                TosAudioMediaRelay relay,
                                @Qualifier("audioMixMessageProducer") GenerationMessageProducer producer) {
        this.stateMachine = stateMachine;
        this.claimService = claimService;
        this.finalizer = finalizer;
        this.claimSpec = ClaimSpec.bySources(
                AudioMixContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.upstreamCredential = upstreamCredential;
        this.gateway = gateway;
        this.relay = relay;
        this.producer = producer;
        this.workerId = "amix-" + ProcessHandle.current().pid();
    }

    @Override public String tag() { return AudioMixContract.TAG; }

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
                    ? domain.getCode() : AudioMixContract.ERROR_AUDIO_MIX_FAILED;
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(error);
            String message = error.getMessage() != null ? error.getMessage() : "音频混合失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            if (!fail(job, code, message, httpStatus)) {
                log.info("[audio_mix] 失败守卫未命中，交由恢复扫描 jobId={} token={}", job.id(), job.fencingToken());
            }
        }
    }

    private void runStep(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        String token;
        try {
            token = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[audio_mix] 生成服务凭证未配置 jobId={}: {}", job.id(), e.getMessage());
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }
        if (job.providerTaskId() == null) submit(job, token);
        else poll(job, token);
    }

    private void submit(ClaimedJob job, String token) {
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

    private void poll(ClaimedJob job, String token) {
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
        boolean published = finalizer.publishAudioMixResult(new PublishMediaExtractDto(
                job.id(), job.projectId(), job.userId(), job.workerId(), job.fencingToken(),
                stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                observed.durationSec()));
        if (!published) log.warn("[audio_mix] 结果发布守卫未命中 jobId={}", job.id());
    }

    private boolean renewLease(ClaimedJob job) {
        return stateMachine.renewAudioMixLease(job.id(), job.workerId(), job.fencingToken());
    }

    private void scheduleNext(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        long delayMs = pollDelayMs(job.pollCount());
        if (stateMachine.rescheduleProviderPoll(job.id(), job.workerId(), job.fencingToken(), job.progress(), delayMs)) {
            producer.enqueue(job.id(), delayMs);
        }
    }

    private boolean cancelIfRequested(ClaimedJob job) {
        return stateMachine.cancelAudioMixIfRequested(job.id(), job.workerId(), job.fencingToken());
    }

    private static long pollDelayMs(int pollCount) {
        return Math.min(60_000L, POLL_INTERVAL_MS << Math.min(4, Math.max(0, pollCount / 3)));
    }

    private static boolean timedOut(ClaimedJob job) {
        if (job.executionDeadlineAt() != null) {
            return !LocalDateTime.now().isBefore(job.executionDeadlineAt());
        }
        if (job.createdAt() == null) return false;
        Object estimated = job.input().get("estimated_duration_ms");
        Duration budget = estimated instanceof Number number && number.longValue() > 0
                ? Duration.ofHours(6).plus(Duration.ofMillis(number.longValue()).multipliedBy(4))
                : Duration.ofDays(7);
        if (budget.compareTo(Duration.ofDays(1)) < 0) budget = Duration.ofDays(1);
        return Duration.between(job.createdAt(), LocalDateTime.now()).compareTo(budget) >= 0;
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

    private boolean fail(ClaimedJob job, String code, String message) {
        return fail(job, code, message, null);
    }

    private boolean fail(ClaimedJob job, String code, String message, Integer httpStatus) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        log.warn("[audio_mix] job 失败 jobId={} code={} message={}", job.id(), code, message);
        FailMediaExtractDto failInput = new FailMediaExtractDto(
                job.id(), job.workerId(), job.fencingToken(), code, message, details);
        return finalizer.failMediaExtractJob(
                failInput.jobId(), failInput.code(), failInput.message(), failInput.details(),
                failInput.workerId(), failInput.fencingToken());
    }
}
