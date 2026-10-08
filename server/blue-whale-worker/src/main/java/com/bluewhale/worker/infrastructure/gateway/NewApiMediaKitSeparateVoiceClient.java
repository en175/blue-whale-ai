package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VocalSplitError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

@Component
public class NewApiMediaKitSeparateVoiceClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；家族客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-separate-voice——最终以网关票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-separate-voice";

    /** 轨类型 → 官方 result URL 键（官方 PDF scene 取值表「输出音轨」列逐字；单源在本类，
     *  契约只冻结轨类型——URL 键名是供应商传输细节，不进跨进程契约）。 */
    private static final Map<String, String> TRACK_URL_KEYS = Map.of(
            "voice", "voice_audio_url",
            "background", "background_audio_url",
            "music", "music_audio_url",
            "sfx", "sfx_audio_url");

    public NewApiMediaKitSeparateVoiceClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VocalSplitContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VocalSplitContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "人声背景分离";
    }

    @Override
    protected String fallbackCode() {
        return VocalSplitContract.ERROR_VOCAL_SPLIT_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VocalSplitError(code, message);
    }

    public String submit(String token, String sourceUrl, boolean sourceIsVideo,
                         String scene, String outputFormat) {
        if (scene == null || !VocalSplitContract.SUPPORTED_SCENES.contains(scene)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离场景非法: " + scene);
        }
        if (outputFormat == null || !VocalSplitContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "人声背景分离输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        // 官方支持视频 / 音频两种输入（video_url / audio_url 二选一），按源 Asset 类型分叉
        payload.put(sourceIsVideo ? "video_url" : "audio_url", sourceUrl);
        // 出站映射官方首字母大写枚举（契约 SCENE_UPSTREAM_MAP 单源，禁止另行发明字面量）
        payload.put("scene", VocalSplitContract.SCENE_UPSTREAM_MAP.get(scene));
        payload.put("output_format", outputFormat);
        return executeSubmit(token, payload);
    }

    /**
     * 查询人声背景分离异步任务（官方「第 2 步：获取结果」：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带按轨类型键的
     *         结果 URL 集（二分法两轨 / 三分法三轨，值 = 24h 临时链接）与 result.duration 秒；
     *         failed 时带上游错误文本供 §5 分类与透传）
     * @throws VocalSplitError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public SeparateVoiceTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new SeparateVoiceTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 逐轨取官方 URL 键（轨类型键承载；二分法只有 voice/background，三分法多
            // music/sfx——按出现即取，不按 scene 预判轨集，缺失轨由 processor 对账）
            JsonNode result = body.data().path("result");
            Map<String, String> trackUrls = new TreeMap<>();
            for (Map.Entry<String, String> entry : TRACK_URL_KEYS.entrySet()) {
                JsonNode urlNode = result.get(entry.getValue());
                if (urlNode != null && urlNode.isTextual() && !urlNode.asText().isEmpty()) {
                    trackUrls.put(entry.getKey(), urlNode.asText());
                }
            }
            JsonNode duration = result.get("duration");
            return new SeparateVoiceTaskObservation("succeeded",
                    trackUrls,
                    duration != null && duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new SeparateVoiceTaskObservation("processing", null, null, null, null);
    }

    /**
     * 人声背景分离任务观测（对齐家族 ExtractAudioTaskObservation 形态，差异 = 多轨：
     * succeeded 时 trackUrls 以轨类型键（voice/background/music/sfx）承载官方
     * result.voice_audio_url / background_audio_url / music_audio_url / sfx_audio_url
     * 的 24h 有效临时链接集（二分法两轨 / 三分法三轨，按出现即取）。
     * status: succeeded | processing | failed
     */
    public record SeparateVoiceTaskObservation(
            String status,
            /** completed 时的轨类型 → 结果 URL（24h 有效临时链接，调用方须立即逐轨转存）。 */
            Map<String, String> trackUrls,
            /** completed 时的 result.duration（秒，官方单值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
