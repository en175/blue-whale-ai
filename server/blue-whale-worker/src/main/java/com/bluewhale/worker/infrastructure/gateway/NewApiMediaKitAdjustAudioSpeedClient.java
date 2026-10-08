package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.AudioSpeedContract;
import com.bluewhale.worker.domain.error.AudioSpeedError;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitAdjustAudioSpeedClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；音频截取客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-adjust-audio-speed——最终以网关配置票确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-adjust-audio-speed";

    public NewApiMediaKitAdjustAudioSpeedClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return AudioSpeedContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return AudioSpeedContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "音频调速";
    }

    @Override
    protected String fallbackCode() {
        return AudioSpeedContract.ERROR_AUDIO_SPEED_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new AudioSpeedError(code, message);
    }

    public String submit(String token, String audioUrl, Double speed) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("audio_url", audioUrl);
        if (speed != null) {
            payload.put("speed", speed);
        }
        return executeSubmit(token, payload);
    }

    /**
     * 查询音频调速异步任务（官方「查询任务」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.audio_url 与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws AudioSpeedError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public AudioSpeedTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new AudioSpeedTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方文档正文与示例均为 result.*（IKHW48 逐字复核证实）；output.* 双读纯为
            // 家族同构容错（trim-audio 官方 PDF 曾自相矛盾，网关转发形状不受本仓控制），
            // 不存在时静默落 null
            JsonNode result = body.data().path("result");
            JsonNode output = body.data().path("output");
            JsonNode audioUrl = result.hasNonNull("audio_url")
                    ? result.path("audio_url") : output.path("audio_url");
            JsonNode duration = result.hasNonNull("duration")
                    ? result.path("duration") : output.path("duration");
            return new AudioSpeedTaskObservation("succeeded",
                    audioUrl.isTextual() ? audioUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new AudioSpeedTaskObservation("processing", null, null, null, null);
    }

    /**
     * 音频调速任务观测（对齐家族 TrimAudioTaskObservation 形态，差异 = 官方
     * result.audio_url 与 result.duration 秒）。
     * status: succeeded | processing | failed
     */
    public record AudioSpeedTaskObservation(
            String status,
            /** completed 时的 result.audio_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String audioUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) {}
}
