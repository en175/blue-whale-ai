package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoSubtitleEraseError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.SocketTimeoutException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * new-api 网关 MediaKit 视频去字幕客户端（迁移契约 §17 / IKGZ81；以 NewApiMediaKitCutoutClient
 * 为模板，差异 = **家族内首个异步任务**：提交返 task_id + 查询端点轮询取结果，区别于
 * 高清/擦除/抠图的单次同步路由）。
 * <p>
 * 端点（网关代理官方 POST /api/v1/tools/erase-video-subtitle-pro；参数名与响应形状以火山
 * 官方 PDF「提交字幕擦除（精细化版）任务 API」为准）：
 * <ul>
 *   <li>submit：POST /v1/mediakit/async/erase-video-subtitle-pro（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET /v1/mediakit/async/tasks/{task_id}（10s 超时，视频轮询同窗口）</li>
 * </ul>
 * 路径是网关侧路由落地前的**假设值**（规格 Further Notes：网关异步路由是上线前置、
 * 配置单阶段确认）；确认后有出入只改本类两个常量。
 * <p>
 * 鉴权与同步家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（§17.3，值单处定义在 {@link VideoSubtitleEraseContract}）：
 * <ul>
 *   <li>model：对客模型名 mediakit-erase-video-subtitle-pro（网关按模型名路由 MediaKit 渠道，
 *       本期 model_price 配 0）</li>
 *   <li>video_url：源视频公网对象存储地址</li>
 *   <li>model_version / output_encode_mode：服务端常量（v5 / Quality），不从前端传入</li>
 *   <li>mode：detect_mode 经 {@link VideoSubtitleEraseContract#MODE} 映射（Subtitle / Text）</li>
 *   <li>erase_ratio_location：框列表**非空才发**（空数组走官方默认行为不发键，≤20）</li>
 * </ul>
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节）：submit = {success, task_id, request_id}
 * （success=false 时带 error{code,type,message,param}）；poll 顶层含 task_id / status
 * （轮询至 completed 或 failed）与 result{video_url, duration}——result.video_url 是
 * 24h 有效临时链接，processor 须立即下载转存。status 大小写与中间态枚举官方 PDF 未
 * 逐字冻结，按小写归一容错解析（completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级）；
 * poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException}
 * 复用），供 processor 按视频骨架 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitSubtitleEraseClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitSubtitleEraseClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 网关异步提交路由路径（假设值，见类注释）。 */
    static final String SUBMIT_PATH = "/v1/mediakit/async/erase-video-subtitle-pro";

    /** 网关异步任务查询路由路径前缀（假设值，见类注释；拼 taskId）。 */
    static final String POLL_PATH_PREFIX = "/v1/mediakit/async/tasks/";

    /** 对客模型名（§17.1：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final String MODEL = "mediakit-erase-video-subtitle-pro";

    /** submit 超时 30s（异步提交秒级入队，取视频 submit 同窗口）。 */
    private static final int SUBMIT_TIMEOUT_MS = 30_000;

    /** poll 超时 10s（视频轮询同窗口）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;

    public NewApiMediaKitSubtitleEraseClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitSubtitleEraseClient(String baseUrl) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }

    /**
     * 提交去字幕异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token      per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl   源视频公网对象存储地址
     * @param detectMode 本仓检测模式（subtitle_smart / text_full，§17.2 冻结枚举）
     * @param eraseBoxes 归一化框列表（官方 Location 键名同构原样透传；空列表不发 erase_ratio_location 键）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoSubtitleEraseError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String detectMode,
                         List<Map<String, Object>> eraseBoxes) {
        String traceId = UUID.randomUUID().toString();

        String mode = VideoSubtitleEraseContract.MODE.get(detectMode);
        if (mode == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw new VideoSubtitleEraseError(GenerationError.ERROR_INVALID_INPUT,
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

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(
                    VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED, "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + SUBMIT_PATH)
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            // 提交超时：上游可能已受理但未拿到 task_id——归终态不重试（宁可不重试也不双跑，
            // 同步家族口径），由 processor 归并兜底码
            throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 去字幕提交超时");
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 去字幕提交失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 网关对 success=false / 未配价 / 缺渠道返 400 且不扣费——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = "去字幕任务提交失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw new VideoSubtitleEraseError(code, message);
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new VideoSubtitleEraseError(code, "MediaKit 去字幕提交业务失败: " + truncate(errText));
            }

            // data 解包宽容（网关可能包 data 层，视频客户端同款）
            JsonNode data = unwrapData(parsed);
            String taskId = textOrNull(data, "task_id");
            if (taskId == null || taskId.isEmpty()) {
                throw new VideoSubtitleEraseError(
                        VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                        "MediaKit 去字幕提交响应缺少 task_id");
            }
            return taskId;
        } catch (VideoSubtitleEraseError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(
                    VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "MediaKit 去字幕提交响应读取失败: " + e.getMessage());
        }
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
        String traceId = UUID.randomUUID().toString();

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + POLL_PATH_PREFIX + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 去字幕任务查询超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            VideoSubtitleEraseError error = new VideoSubtitleEraseError(
                    GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 去字幕任务查询网络不可达");
            error.initCause(e);
            throw error;
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 去字幕任务查询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // HTTP 429/5xx 瞬时（cause 携带状态供 processor 重排）；4xx 业务错 → 硬失败
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                VideoSubtitleEraseError error = new VideoSubtitleEraseError(code,
                        "MediaKit 去字幕任务查询失败: HTTP " + response.code() + " body=" + truncate(rawText));
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);
            JsonNode data = unwrapData(parsed);

            String status = textOrNull(data, "status");
            if (status == null) {
                throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 去字幕任务响应缺少 status");
            }
            String normalized = status.toLowerCase();

            if ("failed".equals(normalized)) {
                // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
                JsonNode rawError = data.has("error") && data.get("error").isObject()
                        ? data.get("error") : parsed.get("error");
                String upstreamCode = rawError != null && rawError.has("code")
                        ? rawError.get("code").asText() : null;
                String upstreamMessage = extractUpstreamMessage(rawText);
                return new SubtitleEraseTaskObservation("failed", null, null,
                        upstreamCode, upstreamMessage);
            }

            if ("completed".equals(normalized)) {
                JsonNode videoUrl = data.path("result").path("video_url");
                JsonNode duration = data.path("result").path("duration");
                return new SubtitleEraseTaskObservation("succeeded",
                        videoUrl.isTextual() ? videoUrl.asText() : null,
                        duration.isNumber() ? duration.asDouble() : null,
                        null, null);
            }

            // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
            return new SubtitleEraseTaskObservation("processing", null, null, null, null);
        } catch (VideoSubtitleEraseError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 去字幕任务响应解析失败: " + e.getMessage());
        }
    }

    // ========== 内部工具 ==========

    private JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw new VideoSubtitleEraseError(
                    VideoSubtitleEraseContract.ERROR_VIDEO_SUBTITLE_ERASE_FAILED,
                    "MediaKit 未返回有效 JSON");
        }
    }

    /** data 解包（网关可能包 data 层；非对象形态回退顶层，视频客户端同款）。 */
    private static JsonNode unwrapData(JsonNode parsed) {
        return parsed.has("data") && parsed.get("data").isObject() ? parsed.get("data") : parsed;
    }

    /**
     * 提取上游可读失败原因（error.message 或顶层 message 字段，两层都读取非空）。
     * 供应商原因透传给前端投影（§17.5 失败段）。
     */
    private static String extractUpstreamMessage(String rawText) {
        try {
            JsonNode node = JSON.readTree(rawText);
            JsonNode message = node.path("error").path("message");
            if (!message.isTextual() || message.asText().isEmpty()) {
                message = node.path("message");
            }
            if (message.isTextual() && !message.asText().isEmpty()) {
                return truncate(message.asText());
            }
        } catch (Exception e) {
            log.debug("上游错误 body 非法 JSON，回退原文截断: {}", e.getMessage());
        }
        return "";
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && v.isTextual()) ? v.asText() : null;
    }

    private static String truncate(String text) {
        return text.length() > 300 ? text.substring(0, 300) + "…" : text;
    }

    private static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
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
    ) {}
}
