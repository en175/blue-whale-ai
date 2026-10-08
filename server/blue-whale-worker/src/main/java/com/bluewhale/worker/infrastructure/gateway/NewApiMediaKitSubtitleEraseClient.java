package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class NewApiMediaKitSubtitleEraseClient extends NewApiMediaKitAsyncTaskClient {

    /** 网关异步提交路由路径（对客；网关按路径末段决定工具，见类注释）。 */
    static final String SUBMIT_PATH = "/v1/mediakit/erase-video-subtitle-pro";

    /** 网关异步任务查询路由路径前缀（拼 taskId）：三个 MediaKit 异步工具共用同一条查询
     *  路由，路径不含 async 段。 */
    static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    /** 对客模型名（§17.1：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-erase-video-subtitle-pro";

    public NewApiMediaKitSubtitleEraseClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "去字幕";
    }

    @Override
    protected String fallbackCode() {
        return VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoSubtitleEraseError(code, message);
    }

    public String submit(String token, String videoUrl, String detectMode,
                         List<Map<String, Object>> eraseBoxes) {
        String mode = VideoSubtitleEraseContract.MODE.get(detectMode);
        if (mode == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "去字幕检测模式非法: " + detectMode);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("model_version", VideoSubtitleEraseContract.MODEL_VERSION);
        payload.put("mode", mode);
        payload.put("output_encode_mode", VideoSubtitleEraseContract.OUTPUT_ENCODE_MODE);
        // §17.3：空数组 = 不拉框走智能默认，出站不传 erase_ratio_location 键（≤20 由创建入口复核）
        if (eraseBoxes != null && !eraseBoxes.isEmpty()) {
            payload.put("erase_ratio_location", eraseBoxes);
        }
        return executeSubmit(token, payload);
    }

    /**
     * 查询去字幕异步任务（官方「异步任务结果」节：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带 result.video_url
     *         与 result.duration 秒；failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoSubtitleEraseError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public SubtitleEraseTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new SubtitleEraseTaskObservation("failed", null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            JsonNode videoUrl = body.data().path("result").path("video_url");
            JsonNode duration = body.data().path("result").path("duration");
            return new SubtitleEraseTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    null, null);
        }

        // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
        return new SubtitleEraseTaskObservation("processing", null, null, null, null);
    }

    /**
     * 去字幕任务观测（对齐 NewApiVideoClient.VideoTaskObservation 形态，差异 = 官方
     * result.duration 秒与上游错误文本）。
     * status: succeeded | processing | failed
     */
    public record SubtitleEraseTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
