package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.FailAudioSpeedDto;
import com.bluewhale.worker.domain.dto.PublishAudioSpeedDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationErrorDetailContract;
import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient.AudioSpeedTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Component
public class AudioSpeedJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(AudioSpeedJobProcessor.class);

    private static final Set<String> PRESERVED_ERROR_CODES = Set.of(
            GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    private static final int LEASE_SECONDS = 420;

    public static final long AUDIO_SPEED_POLL_INTERVAL_MS = 5_000;

    public static final int MAX_AUDIO_SPEED_POLLS = 720;

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiMediaKitAdjustAudioSpeedClient adjustAudioSpeedClient;
    private final TosAudioMediaRelay mediaRelay;
    private final GenerationMessageProducer producer;
    private final String workerId;

    public AudioSpeedJobProcessor(
            JobStateMachineService stateMachine,
            JobClaimService claimService,
            GenerationJobMapper jobMapper,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiMediaKitAdjustAudioSpeedClient adjustAudioSpeedClient,
            TosAudioMediaRelay mediaRelay,
            @Qualifier("audioSpeedMessageProducer")
            GenerationMessageProducer producer
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.typeOnly(AudioSpeedContract.TAG, LEASE_SECONDS, jobMapper);
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.adjustAudioSpeedClient = adjustAudioSpeedClient;
        this.mediaRelay = mediaRelay;
        this.producer = producer;
        this.workerId = "aspeed-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return AudioSpeedContract.TAG;
    }

    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimOpt;
        try {
            claimOpt = claimService.claim(claimSpec, jobId, workerId);
        } catch (Exception error) {
            log.error("[audio_speed] claim 失败 jobId={}: {}",
                    jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJob claim = claimOpt.get();
        log.info("[audio_speed] 已领取 jobId={} token={} providerTaskId={} pollCount={}",
                claim.id(), claim.fencingToken(), claim.providerTaskId(), claim.pollCount());

        try {
            runStep(claim);
        } catch (Exception e) {
            String code = resolveFailCode(e);
            Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(e);
            String message = e.getMessage() != null ? e.getMessage() : "音频调速失败";
            if (httpStatus != null) {
                message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
            }
            log.error("[audio_speed] 终态失败 jobId={} code={}: {}", claim.id(), code, message, e);
            failAudioSpeed(claim, code, message, httpStatus);
        }
    }

    private void runStep(ClaimedJob claim) {
        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[audio_speed] 生成服务凭证未配置 jobId={}: {}", claim.id(), e.getMessage());
            failAudioSpeed(claim, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }

        if (claim.providerTaskId() == null) {
            submitPhase(claim, providerToken);
        } else {
            pollPhase(claim, providerToken);
        }
    }


    private void submitPhase(ClaimedJob claim, String providerToken) {
        Map<String, Object> input = claim.input();

        String sourceAssetId = parseAssetId(input.get(AudioSpeedContract.INPUT_KEY_SOURCE_ASSET_ID));
        if (sourceAssetId == null) {
            failAudioSpeed(claim, GenerationError.ERROR_INVALID_INPUT, "缺少源音频资产 id");
            return;
        }
        Double speed = parseSpeed(input.get(AudioSpeedContract.INPUT_KEY_SPEED));
        if (speed == null && input.containsKey(AudioSpeedContract.INPUT_KEY_SPEED)) {
            failAudioSpeed(claim, GenerationError.ERROR_INVALID_INPUT, "播放倍速格式非法");
            return;
        }

        AssetEntity source = assetSource.resolve(
                Long.parseLong(sourceAssetId),
                Long.parseLong(claim.userId()),
                Long.parseLong(claim.projectId()));
        if (source == null || !"audio".equals(source.getType())
                || source.getUrl() == null || source.getUrl().isEmpty()) {
            failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "源音频资产不可用");
            return;
        }

        String taskId = adjustAudioSpeedClient.submit(providerToken, source.getUrl(), speed);
        log.info("[audio_speed] 上游已提交 jobId={} providerTaskId={} speed={}",
                claim.id(), taskId, speed);

        boolean updated = stateMachine.markProviderSubmitted(
                claim.id(), claim.workerId(), claim.fencingToken(), taskId);
        if (updated) {
            scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
        }
    }


    private void pollPhase(ClaimedJob claim, String providerToken) {
        AudioSpeedTaskObservation observation;
        try {
            observation = adjustAudioSpeedClient.poll(providerToken, claim.providerTaskId());
        } catch (AudioSpeedError pollError) {
            if (isTransientPollError(pollError)) {
                if (claim.pollCount() >= MAX_AUDIO_SPEED_POLLS) {
                    log.warn("[audio_speed] 轮询瞬时错误且已达轮询上限 jobId={} pollCount={} err={}，归失败终态",
                            claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                    Integer httpStatus = NewApiHttpSupport.upstreamHttpStatus(pollError);
                    String message = "音频调速轮询超时（超过 " + MAX_AUDIO_SPEED_POLLS + " 次），上游持续错误: "
                            + pollError.getMessage();
                    if (httpStatus != null) {
                        message = message.replaceAll(": HTTP " + httpStatus + "\\b", ":");
                    }
                    failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED, message, httpStatus);
                    return;
                }
                log.warn("[audio_speed] 轮询瞬时错误 jobId={} pollCount={} err={}，重排继续轮询",
                        claim.id(), claim.pollCount(), pollError.getMessage(), pollError);
                boolean updated = stateMachine.rescheduleProviderPoll(
                        claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
                if (updated) {
                    scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
                }
                return;
            }
            throw pollError;
        }

        if ("processing".equals(observation.status())) {
            if (claim.pollCount() >= MAX_AUDIO_SPEED_POLLS) {
                failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                        "音频调速轮询超时（超过 " + MAX_AUDIO_SPEED_POLLS + " 次）");
                return;
            }
            boolean updated = stateMachine.rescheduleProviderPoll(
                    claim.id(), claim.workerId(), claim.fencingToken(), claim.progress());
            if (updated) {
                scheduleNext(claim.id(), AUDIO_SPEED_POLL_INTERVAL_MS);
            }
            return;
        }

        if ("failed".equals(observation.status())) {
            String message = observation.upstreamMessage() != null && !observation.upstreamMessage().isEmpty()
                    ? observation.upstreamMessage() : "音频调速任务失败";
            String code = classifyUpstreamFailure(observation.upstreamCode(), observation.upstreamMessage());
            log.info("[audio_speed] 上游状态终态=failed jobId={} providerTaskId={} code={} pollCount={}",
                    claim.id(), claim.providerTaskId(), code, claim.pollCount());
            failAudioSpeed(claim, code, message);
            return;
        }

        log.info("[audio_speed] 上游状态终态=completed jobId={} providerTaskId={} pollCount={}",
                claim.id(), claim.providerTaskId(), claim.pollCount());
        if (observation.audioUrl() == null || observation.audioUrl().isEmpty()) {
            failAudioSpeed(claim, AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "音频调速任务成功但未返回结果音频");
            return;
        }
        publishResult(claim, observation);
    }

    private void publishResult(ClaimedJob claim,
                               AudioSpeedTaskObservation observation) {
        if (mediaRelay == null) {
            throw new AudioSpeedError(
                    AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED,
                    "音频转存存储未配置");
        }
        TosAudioMediaRelay.StoredAudio stored =
                mediaRelay.persist(observation.audioUrl(), claim.userId(),
                        AudioSpeedContract.TRANSFER_OUTPUT_FORMAT);
        log.info("[audio_speed] 转存完成 jobId={} storageKey={} size={}",
                claim.id(), stored.storageKey(), stored.size());

        boolean published = finalizer.publishAudioSpeedResult(new PublishAudioSpeedDto(
                claim.id(),
                claim.projectId(),
                claim.userId(),
                claim.workerId(),
                claim.fencingToken(),
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                stored.md5(),
                observation.durationSec()));
        if (published) {
            log.info("[audio_speed] 发布成功 jobId={}", claim.id());
        } else {
            log.warn("[audio_speed] 终态失败(发布守卫未命中) jobId={}（stale worker 或已终态）",
                    claim.id());
        }
    }


    static boolean isTransientPollError(AudioSpeedError error) {
        String code = error.getCode();

        if (GenerationError.ERROR_PROVIDER_TIMEOUT.equals(code)) return true;

        if (GenerationError.ERROR_PROVIDER_FAILED.equals(code)) {
            Throwable cause = error.getCause();
            if (cause instanceof java.net.ConnectException
                    || cause instanceof java.net.UnknownHostException) {
                return true;
            }
            if (cause instanceof NewApiVideoClient.HttpStatusException hse) {
                int status = hse.getStatus();
                return status == 429 || status == 500 || status == 502
                        || status == 503 || status == 504;
            }
        }
        return false;
    }


    private static String parseAssetId(Object obj) {
        if (obj instanceof String s && !s.isEmpty()) return s;
        if (obj instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    private static Double parseSpeed(Object obj) {
        if (obj instanceof Number n) return n.doubleValue();
        return null;
    }

    private static String resolveFailCode(Exception e) {
        if (e instanceof AudioSpeedError ase && PRESERVED_ERROR_CODES.contains(ase.getCode())) {
            return ase.getCode();
        }
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    private static String classifyUpstreamFailure(String upstreamCode, String upstreamMessage) {
        String text = (upstreamCode != null ? upstreamCode : "") + " "
                + (upstreamMessage != null ? upstreamMessage : "");
        if (NewApiErrorClassifier.isCopyrightSignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        }
        if (NewApiErrorClassifier.isContentPolicySignal(text)) {
            return GenerationError.ERROR_CONTENT_REJECTED;
        }
        if (NewApiErrorClassifier.isQuotaSignal(text)) {
            return GenerationError.ERROR_PLATFORM_QUOTA_EXHAUSTED;
        }
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    private void failAudioSpeed(ClaimedJob claim, String code, String message) {
        failAudioSpeed(claim, code, message, null);
    }

    private void failAudioSpeed(ClaimedJob claim, String code, String message,
                                Integer httpStatus) {
        log.warn("audio_speed job 失败 jobId={} code={} message={}", claim.id(), code, message);
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        if (httpStatus != null) {
            details.put(GenerationErrorDetailContract.ERROR_DETAIL_HTTP_STATUS, httpStatus);
        }
        finalizer.failAudioSpeedJob(new FailAudioSpeedDto(
                claim.id(),
                claim.workerId(),
                claim.fencingToken(),
                code,
                message,
                details
        ));
    }

    private void scheduleNext(String jobId, long delayMs) {
        try {
            producer.enqueue(jobId, delayMs);
        } catch (Exception e) {
            log.error("[audio_speed] scheduleNext MQ 发送失败 jobId={} delayMs={}: {}",
                    jobId, delayMs, e.getMessage(), e);
            throw e;
        }
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
