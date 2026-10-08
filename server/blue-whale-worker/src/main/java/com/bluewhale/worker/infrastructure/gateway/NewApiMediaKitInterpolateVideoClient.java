package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoFrameInterpolationError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitInterpolateVideoClient extends NewApiMediaKitAsyncTaskClient {

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕 / HD 高清 / 人声分离客户端
     * MODEL 同款集中一处）。候选值 mediakit-video-frame-interpolation——最终以网关票 IKHLLB
     * 确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-video-frame-interpolation";

    public NewApiMediaKitInterpolateVideoClient(UpstreamBaseUrl baseUrl) {
        super(baseUrl);
    }

    @Override
    protected String submitPath() {
        return VideoFrameInterpolationContract.SUBMIT_PATH;
    }

    @Override
    protected String pollPathPrefix() {
        return VideoFrameInterpolationContract.POLL_PATH_PREFIX;
    }

    @Override
    protected String taskLabel() {
        return "视频插帧";
    }

    @Override
    protected String fallbackCode() {
        return VideoFrameInterpolationContract.ERROR_VIDEO_FRAME_INTERPOLATION_FAILED;
    }

    @Override
    protected RuntimeException error(String code, String message) {
        return new VideoFrameInterpolationError(code, message);
    }

    public String submit(String token, String videoUrl, int fps) {
        if (!VideoFrameInterpolationContract.SUPPORTED_FPS.contains(fps)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw error(GenerationError.ERROR_INVALID_INPUT,
                    "插帧目标帧率非法: " + fps);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        // 整型直传（ADR-0113 契约与代码层命名对齐火山命名，fps 直传整型；字符串 "60" 在
        // 创建入口已被 zod / worker 侧校验拒绝）
        payload.put("fps", fps);
        return executeSubmit(token, payload);
    }

    /**
     * 查询插帧异步任务（官方查询任务 API：轮询至 completed / failed）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带官方 result 四键
     *         video_url / duration 秒 / resolution 档位 / fps；failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoFrameInterpolationError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public InterpolateVideoTaskObservation poll(String token, String taskId) {
        PollBody body = executePoll(token, taskId);
        String normalized = normalizedStatus(body);

        if ("failed".equals(normalized)) {
            // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
            return new InterpolateVideoTaskObservation("failed", null, null, null, null,
                    extractUpstreamCode(body), extractPollUpstreamMessage(body));
        }

        if ("completed".equals(normalized)) {
            // 官方 result 四键（键名单源 = 契约 RESULT_KEYS，禁止另行发明字段名）
            JsonNode result = body.data().path("result");
            JsonNode videoUrl = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_VIDEO_URL);
            JsonNode duration = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_DURATION);
            JsonNode resolution = result.path(
                    VideoFrameInterpolationContract.RESULT_KEY_RESOLUTION);
            JsonNode fps = result.path(VideoFrameInterpolationContract.RESULT_KEY_FPS);
            return new InterpolateVideoTaskObservation("succeeded",
                    videoUrl.isTextual() ? videoUrl.asText() : null,
                    duration.isNumber() ? duration.asDouble() : null,
                    resolution.isTextual() ? resolution.asText() : null,
                    fps.isNumber() ? fps.asDouble() : null,
                    null, null);
        }

        // running / queued 等中间态 → 继续轮询（官方中间态枚举：running；其余统一 processing）
        return new InterpolateVideoTaskObservation("processing", null, null, null, null, null, null);
    }

    /**
     * 插帧任务观测（对齐 {@link NewApiMediaKitEnhanceVideoClient.EnhanceVideoTaskObservation}
     * 形态，字段面 = 官方 result 四键：video_url / duration / resolution / fps）。
     * status: succeeded | processing | failed
     */
    public record InterpolateVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（24h 有效临时链接，调用方须立即下载转存）。 */
            String videoUrl,
            /** completed 时的 result.duration（秒，官方精确值；可 null）。 */
            Double durationSec,
            /** completed 时的 result.resolution（档位字符串，跟随原片；可 null）。 */
            String resolution,
            /** completed 时的 result.fps（与提交时目标帧率一致；可 null）。 */
            Double fps,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
