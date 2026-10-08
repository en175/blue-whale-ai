package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoEnhanceError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitEnhanceVideoClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕 / 音视频分离客户端 MODEL
     * 同款集中一处）。候选值 mediakit-enhance-video-generative——最终以网关票确认为准，
     * 有出入只改本常量。
     */
    static final String MODEL = "mediakit-enhance-video-generative";

    public NewApiMediaKitEnhanceVideoClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoEnhanceContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoEnhanceContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "画质增强";
    }

    @Override
    protected String fallbackCode() {
        return VideoEnhanceContract.ERROR_VIDEO_ENHANCE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoEnhanceError(code, message);
    }

    public String submit(String token, String videoUrl, String resolution) {
        if (resolution == null || !VideoEnhanceContract.SUPPORTED_RESOLUTIONS.contains(resolution)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "画质增强目标分辨率非法: " + resolution);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("resolution", resolution);
        payload.put("bitrate_level", VideoEnhanceContract.BITRATE_LEVEL);
        return executeSubmit(token, payload);
    }

    /**
     * 查询画质增强异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.video_url / duration 秒 / resolution 档位 / fps；failed 时带上游错误
     *         文本供 §5 分类与透传）
     * @throws VideoEnhanceError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public EnhanceVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new EnhanceVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            JsonNode resolution = body.data().path("result").path("resolution");
            JsonNode fps = body.data().path("result").path("fps");
            return new EnhanceVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new EnhanceVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    /**
     * 画质增强任务观测（对齐去字幕 SubtitleEraseTaskObservation 形态，差异 = 官方
     * result.resolution 档位与 result.fps 帧率——assets 无对应列，processor 按档位推导输出
     * 宽高、帧率落 generation_job_logs payload）。
     * status: succeeded | processing | failed
     */
    public record EnhanceVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** completed 时的 result.resolution（档位字符串如 "1080p"，官方示例值；可 null）。 */
            String resolution,
            /** completed 时的 result.fps（帧率，官方精确值——fps 未传时保持原片；可 null）。 */
            Double fps,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
