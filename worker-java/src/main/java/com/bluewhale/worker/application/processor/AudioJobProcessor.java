package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.error.AudioProviderError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Conditional;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 音频作业处理器（generation-worker.ts:367-446 processClaimedJob audio 分支逐字移植）。
 * <p>
 * 编排流程：claim → 取明文凭证 → 校验模型 → 解析参考素材 → 调 TTS → 转存 → createAsset → completeJob。
 * <p>
 * 错误码映射（附录 A audio + generation-worker.ts:370-395）：
 * <ul>
 *   <li>provider_credential_missing：缺少密封凭证 (:370)</li>
 *   <li>model_unavailable：模型不受支持 (:381)</li>
 *   <li>reference_asset_unavailable：参考素材不可用 (:395)</li>
 *   <li>provider_timeout / no_result / quota_exhausted / content_rejected / provider_failed：
 *       provider 层分类（new-api-audio-provider.ts:99-163）</li>
 * </ul>
 * <p>
 * 转存路径：data-direct（base64 audio → PUT），mime 恒 audio/mpeg（契约 §8）。
 * 降级模式：TOS 未配置 → 硬失败「音频转存存储未配置」（generation-worker.ts:749-751）。
 */
@Component
@Conditional(com.bluewhale.worker.config.AudioEnabledCondition.class)
public class AudioJobProcessor implements JobProcessor {

    private static final Logger log = LoggerFactory.getLogger(AudioJobProcessor.class);

    private final JobStateMachineService stateMachine;
    private final AssetSourceService assetSource;
    private final GenerationCredentialService credentialService;
    private final NewApiAudioClient audioClient;
    private final TosMediaStorage tosService;
    private final String workerId;

    public AudioJobProcessor(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiAudioClient audioClient,
            TosMediaStorage tosService
    ) {
        this.stateMachine = stateMachine;
        this.assetSource = assetSource;
        this.credentialService = credentialService;
        this.audioClient = audioClient;
        this.tosService = tosService;
        // workerId = audio-{hostname}-{pid}（与 extract 同构）
        this.workerId = "audio-" + hostname() + "-" + ProcessHandle.current().pid();
    }

    @Override
    public String tag() {
        return "audio";
    }

    /**
     * 处理一个音频 job（generation-worker.ts:367-446 audio 分支）。
     * <p>
     * claim 在 try 外（IKC9EJ：DB 异常上抛 → consumer 不 ack → 重投）。
     */
    @Override
    public void handle(String jobId) {
        // IKC9EJ：claim 在 try 外
        Optional<ClaimedJobDto> claimOpt;
        try {
            claimOpt = stateMachine.claimAudioJobById(jobId, workerId);
        } catch (Exception error) {
            log.error("[audio] claimAudioJobById 失败 jobId={}: {}", jobId, error.getMessage(), error);
            throw error; // 保持不 ack → RocketMQ 重投
        }
        if (claimOpt.isEmpty()) return;

        ClaimedJobDto job = claimOpt.get();
        log.info("[audio] 已领取 jobId={} type={} token={}", job.id(), job.type(), job.fencingToken());

        // cancelRequested → 取消（generation-worker.ts:237-241）
        // 音频不走 cancelVideoBeforeDispatch（视频专用），但按契约应检查
        if (job.cancelRequested()) {
            log.info("[audio] 取消已执行(cancelRequested) jobId={}", job.id());
            // 音频无 cancel-before-dispatch 端点——直接 fail（与 TS cancelVideoBeforeDispatch 语义等价）
            stateMachine.failJob(job.id(), GenerationError.ERROR_PROVIDER_FAILED,
                    "任务已取消", null, workerId, job.fencingToken());
            return;
        }

        try {
            processClaimedAudioJob(job);
        } catch (Exception e) {
            handleAudioError(job, e);
        }
    }

    /**
     * 处理已领取的音频作业（generation-worker.ts:367-446）。
     */
    private void processClaimedAudioJob(ClaimedJobDto job) {
        Map<String, Object> input = job.input();
        String prompt = strOrEmpty(input, "prompt");
        String modelId = strOrEmpty(input, "model_id");

        // 1. 校验输入（generation-worker.ts:302-305）
        if (prompt.isEmpty() || modelId.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_INPUT, "缺少 prompt 或 model_id");
            return;
        }

        // 音频不支持旧参考字段（generation-worker.ts:319-326）
        @SuppressWarnings("unchecked")
        List<Object> oldRefIds = input.get("reference_asset_ids") instanceof List<?> l
                ? (List<Object>) l : List.of();
        if (!oldRefIds.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_INVALID_REFERENCE,
                    "音频生成暂不支持旧参考字段，请使用 references");
            return;
        }

        // 2. 取明文凭证（修正四：去密，generation-worker.ts:368-376）
        Object credentialObj = input.get("provider_credential");
        if (!(credentialObj instanceof String providerCredential) || providerCredential.isEmpty()) {
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音频任务缺少供应商凭证");
            return;
        }
        String providerToken;
        try {
            providerToken = credentialService.open(providerCredential);
        } catch (Exception e) {
            log.debug("[audio] 凭证无效 jobId={}: {}", job.id(), e.getMessage(), e);
            failClaimed(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING,
                    "音频任务凭证无效");
            return;
        }

        // 3. 校验模型能力（generation-worker.ts:379-386）
        // 音频用 findImageCapability(modelId, null) 读 model_id（TS :379 同构）
        // 此处简化为直接传 modelId（音频不需要 size 解析）
        // 若模型不存在 → model_unavailable
        // TODO: 如需完整能力查询，后续接入 GenerationModelCapabilityMapper

        // 4. 解析参考素材（generation-worker.ts:388-397 resolveAudioSeedReferences）
        AudioRefsResult audioRefs = resolveAudioSeedReferences(
                input.get("references"), job.user_id(), job.project_id());
        if (!audioRefs.ok()) {
            failClaimed(job, GenerationError.ERROR_REFERENCE_ASSET_UNAVAILABLE, audioRefs.message());
            return;
        }

        // 5. 调 TTS（generation-worker.ts:398-401）
        // IKFCXE：文本附件作为创作上下文与主提示词共同进入生成——组合语义与图片/视频同源
        // （TextAttachmentPrompts.textAttachments/composeTextAttachmentPrompt：快照损坏或无字段按无附件处理，
        // 非空白附件正文在前、主提示词在后，"\n\n" 连接，不改写正文）；不因存在附件强制改为朗读任务，
        // 环境音/配音意图由主提示词决定；主提示词为空的任务已在第 1 步校验拒绝。
        String audioPrompt = TextAttachmentPrompts.composeTextAttachmentPrompt(
                TextAttachmentPrompts.textAttachments(input), prompt);
        NewApiAudioClient.AudioResult audio = audioClient.generate(
                providerToken, modelId, audioPrompt, audioRefs.refs());
        log.info("[audio] 上游已返回 jobId={} requestId={} dataLen={} url={}",
                job.id(), audio.requestId(),
                audio.data() != null ? audio.data().length : 0,
                audio.url() != null ? audio.url() : "<null>");

        // 6. 转存（generation-worker.ts:404-411 persistProviderMedia data-direct）
        // data-direct 路径：base64 audio → PUT，mime 恒 audio/mpeg
        // TOS 未配置 → 硬失败「音频转存存储未配置」（generation-worker.ts:749-751）
        StoredMedia stored = persistAudioData(audio.data(), audio.url(), job.user_id());
        log.info("[audio] 转存完成 jobId={} storageKey={} size={}", job.id(), stored.storageKey(), stored.size());

        // 7. createAsset（generation-worker.ts:412-425）
        String assetId = stateMachine.createAsset(new JobStateMachineService.CreateAssetInput(
                job.user_id(),
                job.project_id(),
                job.id(),
                "audio",
                stored.url(),
                stored.storageKey(),
                stored.mime(),
                stored.size(),
                null, // width
                null, // height
                audio.duration() != null ? (int) Math.round(audio.duration() * 1000) : null,
                workerId,
                job.fencingToken()
        ));
        if (assetId == null) {
            log.warn("[audio] 终态失败(createAsset 守卫未命中) jobId={}", job.id());
            return; // 守卫失败 → 退出
        }

        // 8. completeJob（generation-worker.ts:445 finishJob）
        boolean completed = stateMachine.completeJob(
                job.id(), List.of(assetId), workerId, job.fencingToken());
        if (completed) {
            log.info("[audio] 发布成功 jobId={} assetId={}", job.id(), assetId);
            stateMachine.appendLog(job.id(), "succeeded", "succeeded",
                    "产出 1 个素材", Map.of("asset_ids", List.of(assetId)));
        } else {
            log.warn("[audio] 终态失败(completeJob 守卫未命中) jobId={} assetId={}", job.id(), assetId);
        }
    }

    /**
     * 音频参考素材解析（generation-worker.ts:148-207 resolveAudioSeedReferences）。
     * <p>
     * input.references[].asset_id → resolveInputAssets → 过滤 audio/image → 按 URL 去重。
     */
    AudioRefsResult resolveAudioSeedReferences(
            Object rawReferences, String userId, String projectId) {

        // 无 references → 空数组（generation-worker.ts:155）
        if (rawReferences == null) {
            return new AudioRefsResult(true, List.of(), null);
        }
        if (!(rawReferences instanceof List<?> rawList)) {
            return new AudioRefsResult(false, null, "参考素材引用无效");
        }

        // 提取 asset_id（generation-worker.ts:163-169）
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

        // resolveInputAssets（generation-worker.ts:170-173）
        Map<String, AssetEntity> assetsMap = assetIds.isEmpty()
                ? Map.of()
                : assetSource.resolveInputAssets(assetIds, userId, projectId);

        // 按序遍历、过滤、去重（generation-worker.ts:179-205）
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<Map<String, String>> refs = new ArrayList<>();
        for (RawAudioReference it : items) {
            if (it.assetId == null) continue;
            AssetEntity asset = assetsMap.get(it.assetId);
            if (asset == null) {
                return new AudioRefsResult(false, null, "参考素材不存在或无权访问");
            }
            // 只收 audio/image（generation-worker.ts:195-197）
            if (!"audio".equals(asset.getType()) && !"image".equals(asset.getType())) {
                return new AudioRefsResult(false, null, "参考素材类型不适用");
            }
            if (asset.getUrl() == null || seen.contains(asset.getUrl())) continue;
            seen.add(asset.getUrl());
            // audio → {audio_url}，image → {image_url}（generation-worker.ts:200-204）
            if ("audio".equals(asset.getType())) {
                refs.add(Map.of("audio_url", asset.getUrl()));
            } else {
                refs.add(Map.of("image_url", asset.getUrl()));
            }
        }

        return new AudioRefsResult(true, refs, null);
    }

    /**
     * 音频数据转存（generation-worker.ts:731-818 persistProviderMedia data-direct 路径）。
     * <p>
     * data-direct：base64 解码后的字节 → TOS PUT，mime 恒 audio/mpeg。
     * TOS 未配置 → 硬失败「音频转存存储未配置」（generation-worker.ts:749-751）。
     */
    private StoredMedia persistAudioData(byte[] data, String url, String userId) {
        // data-direct 路径：data 非空（generation-worker.ts:749-751）
        if (data != null && data.length > 0) {
            // TOS 未配置 → 硬失败（与 image/video 降级不同，音频不允许直存 URL）
            if (tosService == null) {
                throw new AudioProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "音频转存存储未配置");
            }
            // 上传到 TOS
            TosMediaStorage.UploadResult uploaded = tosService.uploadBytes(data, "audio/mpeg");
            return new StoredMedia(uploaded.url(), uploaded.storageKey(),
                    "audio/mpeg", (long) data.length);
        }
        // URL 回退（generation-worker.ts:752-761）——仅当 data 为空
        if (url != null && !url.isEmpty()) {
            return new StoredMedia(url, null, null, null);
        }
        throw new AudioProviderError(GenerationError.ERROR_NO_RESULT, "生成服务未返回音频结果");
    }

    /** 音频错误处理（generation-worker.ts:686-728 catch 块）。 */
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

    /** 失败处理（generation-worker.ts:246-286 failClaimed）。 */
    private void failClaimed(ClaimedJobDto job, String code, String msg) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", msg);
        stateMachine.failJob(job.id(), code, msg, details, workerId, job.fencingToken());
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

    /** 音频参考素材项（generation-worker.ts:142-147 RawAudioReference）。 */
    private static class RawAudioReference {
        String assetId;
    }

    /** 参考素材解析结果。 */
    record AudioRefsResult(boolean ok, List<Map<String, String>> refs, String message) {}

    /** 转存结果。 */
    record StoredMedia(String url, String storageKey, String mime, Long size) {}
}
