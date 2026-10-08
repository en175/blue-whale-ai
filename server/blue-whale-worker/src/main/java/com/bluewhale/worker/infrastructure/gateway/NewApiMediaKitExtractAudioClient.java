package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitExtractAudioClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-extract-audio——最终以网关票 IKH28Y 确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-extract-audio";

    public NewApiMediaKitExtractAudioClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return MediaExtractContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return MediaExtractContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频提取";
    }

    @Override
    protected String fallbackCode() {
        return MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new MediaExtractError(code, message);
    }

    public String submit(String token, String videoUrl, String outputFormat) {
        if (outputFormat == null || !MediaExtractContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "音频提取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    /**
     * 查询音频提取异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.audio_url 与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws MediaExtractError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public ExtractAudioTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new ExtractAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode audioUrl = body.data().path("result").path("audio_url");
            JsonNode duration = body.data().path("result").path("duration");
            return new ExtractAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new ExtractAudioTaskObservation("processing", null, null, null, null);
    }

    /**
     * 音频提取任务观测（对齐去字幕 SubtitleEraseTaskObservation 形态，差异 = 官方
     * result.audio_url 与 result.duration 秒）。
     * status: succeeded | processing | failed
     */
    public record ExtractAudioTaskObservation(
            String status,
            /** completed 时的 result.audio_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String audioUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
