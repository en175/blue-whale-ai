package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
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
import java.util.Map;
import java.util.UUID;

/**
 * new-api 网关 MediaKit 智能抠像客户端（IKHK99，父规格 IKHJRC，契约 IKHK7F；以
 * {@link NewApiMediaKitSegmentScenesClient} 为模板——家族 MediaKit 异步任务，差异 =
 * **双端点按模式分流**：portrait → matte-portrait-video、greenscreen →
 * matte-greenscreen-video，提交路径与模型名均经契约 {@link VideoMattingContract#SUBMIT_PATHS} /
 * {@link VideoMattingContract#MODEL_NAMES} 映射单源取值〔对客候选值，最终以网关配置票
 * IKHK9O 定稿为准回填契约〕；两工具 API 独立、任务流程完全相同、共用同一个 tasks 查询）。
 * <p>
 * 端点（网关**对客**路径，常量单源在 {@link VideoMattingContract}）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATHS[mode]}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——MediaKit 异步工具家族共用
 *       同一条查询路由，路径不含 async 段（IKH67T 实测校准）</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。
 * 火山上游侧对应 POST /api/v1/tools/matte-portrait-video 与 /api/v1/tools/matte-greenscreen-video
 * （官方开发指南 PDF 逐字），由网关内部转发，本仓不直连上游。鉴权与家族同构（契约 §5 /
 * ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-（processor 从
 * job.input.provider_credential 取出传入）+ X-Trace-Id + X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方开发指南 PDF「快速入门」+「进阶使用·选择输出格式与背景颜色」节）：
 * model（对客模型名，按模式取值，网关按模型名路由 MediaKit 渠道，本期 model_price 配 0）+
 * video_url（源视频公网对象存储地址）+ format（WEBM / MP4 透传）+ background_color
 * （**仅 format=MP4 时出站且显式携带**——官方两端点默认底色不同〔人像 green、绿幕 black〕，
 * 本仓统一冻结 white 防歧义；WEBM 透明不接受背景色）。模式不进出站参数（选择端点即选择
 * 模式）。不发 client_token（本仓 command_idempotency 幂等键，与官方提交参数无关）/
 * callback_url / callback_args / queue_id / media_output_destination（家族轮询口径 +
 * worker 转存自家 TOS，ADR-0112）。
 * <p>
 * 响应形状（官方开发指南 PDF）：submit = {success, task_id, request_id}（success=false 时带
 * error{code,type,message,param}）；poll 顶层含 task_id / status 与 completed 态
 * result{video_url, resolution, duration}——video_url 为 24h 临时链接，processor 须立即
 * 转存自家 TOS（查询接口在结果临期 2 小时内自动续期，轮询天然保活）。status 大小写与
 * 中间态枚举官方 PDF 未逐字冻结，按小写归一容错解析（completed→succeeded、failed→failed、
 * 其余→processing，家族先例同款）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级；
 * 本 PDF 未含错误对象节，错误信封口径 = 家族先例）；poll 的网络超时 / 连接失败 /
 * HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException} 复用），
 * 供 processor 按 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitMatteVideoClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitMatteVideoClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** 网关异步提交路由路径映射（对客；契约常量单源，IKH67T：禁止写火山上游路径）。 */
    static final Map<String, String> SUBMIT_PATHS = VideoMattingContract.SUBMIT_PATHS;

    /** 网关异步任务查询路由路径前缀（拼 taskId；契约常量单源）。 */
    static final String POLL_PATH_PREFIX = VideoMattingContract.POLL_PATH_PREFIX;

    /** 模式 → 对客模型名映射（契约常量单源：网关渠道路由 + model_price 配 0 免费口径）。 */
    static final Map<String, String> MODEL_NAMES = VideoMattingContract.MODEL_NAMES;

    /** submit 超时 30s（异步提交秒级入队，去字幕家族同窗口）。 */
    private static final int SUBMIT_TIMEOUT_MS = 30_000;

    /** poll 超时 10s（去字幕家族同窗口）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;

    public NewApiMediaKitMatteVideoClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitMatteVideoClient(String baseUrl) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }

    /**
     * 提交智能抠像异步任务（官方「提交成功响应」：返回 task_id；双端点按模式分流）。
     *
     * @param token           per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl        源视频公网对象存储地址
     * @param mode            任务冻结的抠像模式（portrait / greenscreen，IKHK7F 契约枚举；
     *                        经契约 SUBMIT_PATHS / MODEL_NAMES 分流端点与模型名）
     * @param format          输出格式（WEBM / MP4，透传官方 format 参数）
     * @param backgroundColor MP4 纯色背景色（white / black / green；仅 format=MP4 时非 null——
     *                        显式携带防两端点官方默认底色歧义；WEBM 时须为 null，出站不带）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoMattingError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String mode, String format, String backgroundColor) {
        String traceId = UUID.randomUUID().toString();

        String submitPath = SUBMIT_PATHS.get(mode);
        String model = MODEL_NAMES.get(mode);
        if (submitPath == null || model == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT,
                    "抠像模式非法: " + mode);
        }
        if (!VideoMattingContract.SUPPORTED_FORMATS.contains(format)) {
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT,
                    "抠像输出格式非法: " + format);
        }
        if (!"MP4".equals(format) && backgroundColor != null) {
            // WEBM 透明不接受背景色（契约 refine 同款），防御历史脏值：拒绝而非静默改写
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT,
                    "WEBM 透明输出不接受 background_color");
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put(VideoMattingContract.SUBMIT_KEY_VIDEO_URL, videoUrl);
        payload.put(VideoMattingContract.SUBMIT_KEY_FORMAT, format);
        if (backgroundColor != null) {
            payload.put(VideoMattingContract.SUBMIT_KEY_BACKGROUND_COLOR, backgroundColor);
        }

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED, "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + submitPath)
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
            throw new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 智能抠像提交超时");
        } catch (Exception e) {
            throw new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 智能抠像提交失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 网关对 success=false / 未配价 / 缺渠道返 400 且不扣费——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = "智能抠像任务提交失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw new VideoMattingError(code, message);
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new VideoMattingError(code, "MediaKit 智能抠像提交业务失败: " + truncate(errText));
            }

            // data 解包宽容（网关可能包 data 层，视频客户端同款）
            JsonNode data = unwrapData(parsed);
            String taskId = textOrNull(data, "task_id");
            if (taskId == null || taskId.isEmpty()) {
                throw new VideoMattingError(
                        VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                        "MediaKit 智能抠像提交响应缺少 task_id");
            }
            return taskId;
        } catch (VideoMattingError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "MediaKit 智能抠像提交响应读取失败: " + e.getMessage());
        }
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
            throw new VideoMattingError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 智能抠像任务查询超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            VideoMattingError error = new VideoMattingError(
                    GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 智能抠像任务查询网络不可达");
            error.initCause(e);
            throw error;
        } catch (Exception e) {
            throw new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 智能抠像任务查询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // HTTP 429/5xx 瞬时（cause 携带状态供 processor 重排）；4xx 业务错 → 硬失败
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                VideoMattingError error = new VideoMattingError(code,
                        "MediaKit 智能抠像任务查询失败: HTTP " + response.code() + " body=" + truncate(rawText));
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);
            JsonNode data = unwrapData(parsed);

            String status = textOrNull(data, "status");
            if (status == null) {
                throw new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 智能抠像任务响应缺少 status");
            }
            String normalized = status.toLowerCase();

            if ("failed".equals(normalized)) {
                // 上游错误信号：error 对象（code/message/param/type——TaskError / ApiError）与
                // 顶层 message 都读、取非空合并
                JsonNode rawError = data.has("error") && data.get("error").isObject()
                        ? data.get("error") : parsed.get("error");
                String upstreamCode = rawError != null && rawError.has("code")
                        ? rawError.get("code").asText() : null;
                String upstreamMessage = extractUpstreamMessage(rawText);
                return new MatteVideoTaskObservation("failed", null, null, null,
                        upstreamCode, upstreamMessage);
            }

            if ("completed".equals(normalized)) {
                JsonNode result = data.path("result");
                String videoUrl = textOrNull(result, "video_url");
                String resolution = textOrNull(result, "resolution");
                Double durationSec = result.path("duration").isNumber()
                        ? result.path("duration").asDouble() : null;
                return new MatteVideoTaskObservation("succeeded", videoUrl, resolution, durationSec,
                        null, null);
            }

            // running / queued 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
            return new MatteVideoTaskObservation("processing", null, null, null, null, null);
        } catch (VideoMattingError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoMattingError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 智能抠像任务响应解析失败: " + e.getMessage());
        }
    }

    // ========== 内部工具 ==========

    private JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw new VideoMattingError(
                    VideoMattingContract.ERROR_VIDEO_MATTING_FAILED,
                    "MediaKit 未返回有效 JSON");
        }
    }

    /** data 解包（网关可能包 data 层；非对象形态回退顶层，视频客户端同款）。 */
    private static JsonNode unwrapData(JsonNode parsed) {
        return parsed.has("data") && parsed.get("data").isObject() ? parsed.get("data") : parsed;
    }

    /**
     * 提取上游可读失败原因（error.message 或顶层 message 字段，两层都读取非空）。
     * 供应商原因透传给前端投影（错误映射口径：可读文案）。
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
    ) {}
}
