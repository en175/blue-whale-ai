package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class NewApiMediaKitMatteVideoClient {

    /** 模式 → 单端点客户端（模式集合直接取契约 SUBMIT_PATHS 的键：端点即模式，无第二份枚举）。 */
    private final Map<String, EndpointClient> endpoints;

    public NewApiMediaKitMatteVideoClient(UpstreamBaseUrl baseUrl) {
        Map<String, EndpointClient> clients = new LinkedHashMap<>();
        for (String mode : VideoMattingContract.SUBMIT_PATHS.keySet()) {
            clients.put(mode, new EndpointClient(baseUrl, mode));
        }
        this.endpoints = Map.copyOf(clients);
    }

    public String submit(String token, String videoUrl, String mode, String format, String backgroundColor) {
        return endpointOf(mode).submit(token, videoUrl, format, backgroundColor);
    }

    /**
     * 查询智能抠像异步任务（两工具共用同一个查询端点；轮询至 completed / failed，窗口 30 天）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.video_url（24h 临时链接）/ result.resolution 档位 / result.duration 秒；
     *         failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoMattingError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public MatteVideoTaskObservation poll(String token, String taskId) {
        // 查询路由与模式无关（契约 POLL_PATH_PREFIX 单源），任一单端点实例执行等价
        return endpoints.values().iterator().next().poll(token, taskId);
    }

    private EndpointClient endpointOf(String mode) {
        EndpointClient endpoint = endpoints.get(mode);
        if (endpoint == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT, "抠像模式非法: " + mode);
        }
        return endpoint;
    }

    /**
     * 单端点客户端（一个上游工具 = 一条提交路径 = 一个模型名；IKHKMK 家族模板形态：
     * 模板方法五件套 + 契约枚举校验 + 出站 payload 构造 + completed 结果解析）。
     */
    static final class EndpointClient extends NewApiMediaKitAsyncTaskClient {

        /** 本端点对应的抠像模式（契约 MODE_* 常量，用于取路径与模型名）。 */
        private final String mode;

        EndpointClient(UpstreamBaseUrl baseUrl, String mode) {
            super(baseUrl);
            this.mode = mode;
        }

        @Override
        protected String submitPath() {
            return VideoMattingContract.SUBMIT_PATHS.get(mode);
        }

        @Override
        protected String pollPathPrefix() {
            return VideoMattingContract.POLL_PATH_PREFIX;
        }

        @Override
        protected String taskLabel() {
            return "智能抠像";
        }

        @Override
        protected String fallbackCode() {
            return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
        }

        @Override
        protected RuntimeException error(String code, String message) {
            return new VideoMattingError(code, message);
        }

        /**
         * 本端点提交（模式由实例固定，无需再传）。
         *
         * @param token           per-job Bearer 凭证
         * @param videoUrl        源视频公网对象存储地址
         * @param format          输出格式（WEBM / MP4）
         * @param backgroundColor MP4 纯色背景色（WEBM 时须为 null）
         * @return 上游任务 id
         */
        String submit(String token, String videoUrl, String format, String backgroundColor) {
            if (!VideoMattingContract.SUPPORTED_FORMATS.contains(format)) {
                throw error(GenerationError.ERROR_INVALID_INPUT, "抠像输出格式非法: " + format);
            }
            if (!VideoMattingContract.FORMAT_MP4.equals(format) && backgroundColor != null) {                // WEBM 透明不接受背景色（契约 refine 同款），防御历史脏值：拒绝而非静默改写
                throw error(GenerationError.ERROR_INVALID_INPUT, "WEBM 透明输出不接受 background_color");
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("model", VideoMattingContract.MODEL_NAMES.get(mode));
            payload.put(VideoMattingContract.SUBMIT_KEY_VIDEO_URL, videoUrl);
            payload.put(VideoMattingContract.SUBMIT_KEY_FORMAT, format);
            if (backgroundColor != null) {
                payload.put(VideoMattingContract.SUBMIT_KEY_BACKGROUND_COLOR, backgroundColor);
            }
            return executeSubmit(token, payload);
        }

        /**
         * 本端点任务查询（status 三分支判定 + completed 结果解析）。
         *
         * @return 观测结果（见 {@link MatteVideoTaskObservation}）
         */
        MatteVideoTaskObservation poll(String token, String taskId) {
            PollBody body = executePoll(token, taskId);
            String normalized = normalizedStatus(body);

            if ("failed".equals(normalized)) {
                // 上游错误信号：error 对象（code/message/param/type——TaskError / ApiError）与
                // 顶层 message 都读、取非空合并（骨架 extract* 两方法同款）
                return new MatteVideoTaskObservation("failed", null, null, null,
                        extractUpstreamCode(body), extractPollUpstreamMessage(body));
            }

            if ("completed".equals(normalized)) {
                JsonNode result = body.data().path("result");
                String videoUrl = NewApiMediaKitJsonSupport.textOrNull(result, "video_url");
                String resolution = NewApiMediaKitJsonSupport.textOrNull(result, "resolution");
                Double durationSec = result.path("duration").isNumber()
                        ? result.path("duration").asDouble() : null;
                return new MatteVideoTaskObservation("succeeded", videoUrl, resolution, durationSec,
                        null, null);
            }

            // running / queued 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
            return new MatteVideoTaskObservation("processing", null, null, null, null, null);
        }
    }

    /**
     * 智能抠像任务观测（对齐 SceneSplitTaskObservation 形态，差异 = 单产物 result 三键）。
     * status: succeeded | processing | failed。
     */
    public record MatteVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（火山 24h 临时链接，调用方须立即下载转存
             *  自有存储，不跨进程落库）。 */
            String videoUrl,
            /** completed 时的 result.resolution 档位（字符串如 "1080p"，同名同值透传；可 null，
             *  processor 判缺失落兜底失败）。 */
            String resolution,
            /** completed 时的 result.duration（秒，官方精确值；可 null，缺失回落源时长）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
