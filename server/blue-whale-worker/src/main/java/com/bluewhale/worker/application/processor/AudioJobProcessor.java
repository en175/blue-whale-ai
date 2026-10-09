package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.error.AudioProviderError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class AudioJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(AudioJobProcessor.class);

    private final JobStateMachineService stateMachine;
    private final JobFinalizer finalizer;
    private final AssetSourceService assetSource;
    private final UpstreamCredential upstreamCredential;
    private final NewApiAudioClient audioClient;
    private final TosMediaStorage tosService;
    private final String workerId;

    public AudioJobProcessor(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiAudioClient audioClient,
            TosMediaStorage tosService
    ) {
        this.stateMachine = stateMachine;
        this.finalizer = finalizer;
        this.assetSource = assetSource;
        this.upstreamCredential = upstreamCredential;
        this.audioClient = audioClient;
        this.tosService = tosService;
        this.workerId = "audio-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return GenerationMqRouteEnum.AUDIO.tag();
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimAudioJobById(jobId, workerId);
        } catch (Exception error) {
            log.error("[audio] claimAudioJobById 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error;
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJobDto job = claimOpt.get();
        log.info("[audio] 已领取 jobId={} type={} token={}", job.id(), job.type(), job.fencingToken());

        if (job.cancelRequested()) {
            log.info("[audio] 取消已执行(cancelRequested) jobId={}", job.id());
            finalizer.failJob(job.id(), GenerationError.ERROR_PROVIDER_FAILED,
                    "任务已取消", null, workerId, job.fencingToken());
            return;
        }

        try {
            processClaimedAudioJob(job);
        } catch (Exception e) {
            handleAudioError(job, e);
        }
    }

    private void processClaimedAudioJob(ClaimedJobDto job) {
        Map<String, Object> input = job.input();
        String prompt = strOrEmpty(input, "prompt");
        String modelId = strOrEmpty(input, "model_id");

        if (prompt.isEmpty() || modelId.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_INPUT, "缺少 prompt 或 model_id");
            return;
        }

        @SuppressWarnings("unchecked")
        List<Object> oldRefIds = input.get("reference_asset_ids") instanceof List<?> l
                ? (List<Object>) l : List.of();
        if (!oldRefIds.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                    "音频生成暂不支持旧参考字段，请使用 references");
            return;
        }

        String providerToken;
        try {
            providerToken = upstreamCredential.requireKey();
        } catch (IllegalStateException e) {
            log.warn("[audio] 生成服务凭证未配置 jobId={}: {}", job.id(), e.getMessage());
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "生成服务凭证未配置");
            return;
        }


        AudioRefsResult audioRefs = resolveAudioSeedReferences(
                input.get("references"), job.user_id(), job.project_id());
        if (!audioRefs.ok()) {
            failClaimed(job, GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE, audioRefs.message());
            return;
        }

        NewApiAudioClient.AudioResult audio = audioClient.generate(
                providerToken, modelId, prompt, audioRefs.refs());
        log.info("[audio] 上游已返回 jobId={} requestId={} dataLen={} url={}",
                job.id(), audio.requestId(),
                audio.data() != null ? audio.data().length : 0,
                audio.url() != null ? audio.url() : "<null>");

        StoredMedia stored = persistAudioData(audio.data(), audio.url(), job.user_id());
        log.info("[audio] 转存完成 jobId={} storageKey={} size={}", job.id(), stored.storageKey(), stored.size());

        Long audioSeconds = null;
        Integer durationMs = null;
        if (audio.duration() != null && audio.duration() > 0) {
            audioSeconds = Math.max(1L, Math.round(audio.duration()));
            durationMs = (int) Math.round(audio.duration() * 1000);
        } else {
            log.warn("[audio] 上游未返回 duration，结算将缺少 usage.seconds 而被拒：jobId={} —— "
                    + "可用 billing 的 POST /admin/jobs/{id}/settle 人工补", job.id());
        }

        String assetId = stateMachine.createAsset(new JobStateMachineService.CreateAssetInput(
                job.user_id(),
                job.project_id(),
                job.id(),
                "audio",
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                stored.md5(),
                null,
                null,
                durationMs,
                workerId,
                job.fencingToken()
        ));
        if (assetId == null) {
            log.warn("[audio] 终态失败(createAsset 守卫未命中) jobId={}", job.id());
            return;
        }

        boolean completed = finalizer.completeJob(
                job.id(), List.of(assetId), workerId, job.fencingToken(), audioSeconds);
        if (completed) {
            log.info("[audio] 发布成功 jobId={} assetId={}", job.id(), assetId);
            stateMachine.appendLog(job.id(), "succeeded", "succeeded",
                    "产出 1 个素材", Map.of("asset_ids", List.of(assetId)));
        } else {
            log.warn("[audio] 终态失败(completeJob 守卫未命中) jobId={} assetId={}", job.id(), assetId);
        }
    }

    AudioRefsResult resolveAudioSeedReferences(
            Object rawReferences, String userId, String projectId) {

        if (rawReferences == null) {
            return new AudioRefsResult(true, List.of(), null);
        }
        if (!(rawReferences instanceof List<?> rawList)) {
            return new AudioRefsResult(false, null, "参考素材引用无效");
        }

        List<String> assetIds = new ArrayList<>();
        List<RawAudioReference> items = new ArrayList<>();
        for (Object item : rawList) {
            if (item instanceof Map<?, ?> map) {
                RawAudioReference ref = new RawAudioReference();
                Object aid = map.get("asset_id");
                ref.assetId = (aid instanceof String s && !s.isEmpty()) ? s : null;
                items.add(ref);
                if (ref.assetId != null) {
                    assetIds.add(ref.assetId);
                }
            }
        }

        Map<String, AssetEntity> assetsMap = assetIds.isEmpty()
                ? Map.of()
                : assetSource.resolveInputAssets(assetIds, userId, projectId);

        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<Map<String, String>> refs = new ArrayList<>();
        for (RawAudioReference it : items) {
            if (it.assetId == null) continue;
            AssetEntity asset = assetsMap.get(it.assetId);
            if (asset == null) {
                return new AudioRefsResult(false, null, "参考素材不存在或无权访问");
            }
            if (!"audio".equals(asset.getType()) && !"image".equals(asset.getType())) {
                return new AudioRefsResult(false, null, "参考素材类型不适用");
            }
            if (asset.getUrl() == null || seen.contains(asset.getUrl())) continue;
            seen.add(asset.getUrl());
            if ("audio".equals(asset.getType())) {
                refs.add(Map.of("audio_url", asset.getUrl()));
            } else {
                refs.add(Map.of("image_url", asset.getUrl()));
            }
        }

        return new AudioRefsResult(true, refs, null);
    }

    private StoredMedia persistAudioData(byte[] data, String url, String userId) {
        if (data != null && data.length > 0) {
            if (tosService == null) {
                throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "音频转存存储未配置");
            }
            TosMediaStorage.UploadResult uploaded = tosService.uploadBytes(data, "audio/mpeg");
            return new StoredMedia(uploaded.url(), uploaded.storageKey(),
                    "audio/mpeg", (long) data.length, uploaded.md5());
        }
        if (url != null && !url.isEmpty()) {
            log.warn("[audio] 上游未返回字节，仅回退 URL：assets.md5 将为空（IKGS73 已知边界）");
            return new StoredMedia(url, null, null, null, null);
        }
        throw new AudioProviderError(GenerationError.ERROR_NO_RESULT, "生成服务未返回音频结果");
    }

    private void handleAudioError(ClaimedJobDto job, Exception e) {
        String code;
        String msg;
        if (e instanceof AudioProviderError ape) {
            code = ape.getCode();
            msg = ape.getMessage();
        } else {
            code = GenerationError.ERROR_PROVIDER_FAILED;
            msg = e.getMessage() != null ? e.getMessage() : "unknown";
        }

        log.error("[audio] 终态失败 jobId={} code={}: {}",
                job.id(), code, msg, e);

        failClaimed(job, code, msg);
    }

    private void failClaimed(ClaimedJobDto job, String code, String msg) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        finalizer.failJob(job.id(), code, msg, details, workerId, job.fencingToken());
    }

    private static String strOrEmpty(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return (v instanceof String s) ? s : "";
    }

    private static String hostname() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static class RawAudioReference {
        String assetId;
    }

    record AudioRefsResult(boolean ok, List<Map<String, String>> refs, String message) {}

    record StoredMedia(String url, String storageKey, String mime, Long size, String md5) {}
}
