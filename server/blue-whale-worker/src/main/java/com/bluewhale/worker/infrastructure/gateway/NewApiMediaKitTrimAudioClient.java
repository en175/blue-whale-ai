package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.error.AudioTrimError;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitTrimAudioClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；音视频分离客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-trim-audio——最终以网关配置票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-trim-audio";

    public NewApiMediaKitTrimAudioClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioTrimContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioTrimContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频截取";
    }

    @Override
    protected String fallbackCode() {
        return AudioTrimContract.ERROR_AUDIO_TRIM_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioTrimError(code, message);
    }

    public String submit(String token, String audioUrl, Double startTime, Double endTime,
                         String outputFormat) {
        if (outputFormat == null || !AudioTrimContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "音频截取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (startTime != null) {
            payload.put("start_time", startTime);
        }
        if (endTime != null) {
            payload.put("end_time", endTime);
        }
        payload.put("format", outputFormat);
        return executeSubmit(token, payload);
    }

    /**
     * 查询音频裁剪异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.audio_url 与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws AudioTrimError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public TrimAudioTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new TrimAudioTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方 PDF 自相矛盾：正文表格写 result.*、「最终的完整任务信息示例」JSON 却是
            // output.*——result 优先、output 兜底双读，防 completed 被误读成无结果
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new TrimAudioTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new TrimAudioTaskObservation("processing", null, null, null, null);
    }

    /**
     * 音频裁剪任务观测（对齐家族 ExtractAudioTaskObservation 形态，差异 = 官方
     * result.audio_url 与 result.duration 秒）。
     * status: succeeded | processing | failed
     */
    public record TrimAudioTaskObservation(
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
