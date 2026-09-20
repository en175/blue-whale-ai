package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
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
 * new-api 网关 MediaKit 音频提取（音视频分离）客户端（迁移契约 §18 / IKH28W；以
 * {@link NewApiMediaKitSubtitleEraseClient} 为模板——家族内第二个 MediaKit 异步任务：
 * 提交返 task_id + 查询端点轮询取 result.audio_url / result.duration）。
 * <p>
 * 端点（官方 PDF「提交音频提取任务 API」POST /api/v1/tools/extract-audio；路径常量单源在
 * {@link MediaExtractContract}，契约票 IKH28T 已冻结）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATH}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——官方 PDF 无查询端点文档，
 *       暂按去字幕假设值先例承载，待网关票 IKH28Y 确认（确认后只改契约常量）</li>
 * </ul>
 * 鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的用户 sk-
 * （processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方 PDF Body 参数节）：model（对客模型名，网关按模型名路由 MediaKit 渠道，
 * 本期 model_price 配 0）+ video_url（源视频公网对象存储地址）+ format（= 任务冻结的
 * output_format，五值枚举同名同值透传，缺省 m4a 由创建入口落定）。
 * 不发 media_output_destination（走默认临时链接 + 自家 TOS 转存，去字幕家族口径）、
 * client_token / callback_* / queue_id（无幂等与回调需求）。
 * <p>
 * 响应形状（官方 PDF「响应说明」+「异步任务结果」节逐字）：submit =
 * {success, task_id, request_id}（success=false 时带 error{code,type,message,param}）；
 * poll 顶层含 task_id / status（轮询至 completed 或 failed）与 result{audio_url, duration}——
 * result.audio_url 是 24h 有效 HTTPS 临时下载链接（官方「请及时下载保存」），processor 须
 * 立即转存自家 TOS。status 大小写与中间态枚举官方 PDF 未逐字冻结，按小写归一容错解析
 * （completed→succeeded、failed→failed、其余→processing）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级，
 * §18.4 第一类：网关错误不透传英文）；poll 的网络超时 / 连接失败 / HTTP 429/5xx 抛错时以
 * cause 携带状态（{@link NewApiVideoClient.HttpStatusException} 复用），供 processor 按
 * isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitExtractAudioClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitExtractAudioClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /**
     * 对客模型名（网关渠道路由 + model_price 配 0 免费口径；去字幕客户端 MODEL 同款集中一处）。
     * 候选值 mediakit-extract-audio——最终以网关票 IKH28Y 确认为准，有出入只改本常量。
     */
    static final String MODEL = "mediakit-extract-audio";

    /** submit 超时 30s（异步提交秒级入队，去字幕家族同窗口）。 */
    private static final int SUBMIT_TIMEOUT_MS = 30_000;

    /** poll 超时 10s（去字幕家族同窗口）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;

    public NewApiMediaKitExtractAudioClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitExtractAudioClient(String baseUrl) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }

    /**
     * 提交音频提取异步任务（官方「响应说明」：成功返回 task_id）。
     *
     * @param token        per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl     源视频公网对象存储地址
     * @param outputFormat 任务冻结的输出格式（§18.2 五值枚举，出站映射官方 format 参数）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws MediaExtractError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String outputFormat) {
        String traceId = UUID.randomUUID().toString();

        if (outputFormat == null || !MediaExtractContract.SUPPORTED_OUTPUT_FORMATS.contains(outputFormat)) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw new MediaExtractError(GenerationError.ERROR_INVALID_INPUT,
                    "音频提取输出格式非法: " + outputFormat);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MODEL);
        payload.put("video_url", videoUrl);
        payload.put("format", outputFormat);

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED, "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + MediaExtractContract.SUBMIT_PATH)
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            // 提交超时：上游可能已受理但未拿到 task_id——归终态不重试（宁可不重试也不双跑，
            // 家族口径），由 processor 归并兜底码
            throw new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 音频提取提交超时");
        } catch (Exception e) {
            throw new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 音频提取提交失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 官方同步错误结构 error{code,message,param,type}（success=false 任务不创建）——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = "音频提取任务提交失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw new MediaExtractError(code, message);
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw new MediaExtractError(code, "MediaKit 音频提取提交业务失败: " + truncate(errText));
            }

            // data 解包宽容（网关可能包 data 层，去字幕客户端同款）
            JsonNode data = unwrapData(parsed);
            String taskId = textOrNull(data, "task_id");
            if (taskId == null || taskId.isEmpty()) {
                throw new MediaExtractError(
                        MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                        "MediaKit 音频提取提交响应缺少 task_id");
            }
            return taskId;
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                    "MediaKit 音频提取提交响应读取失败: " + e.getMessage());
        }
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
        String traceId = UUID.randomUUID().toString();

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + MediaExtractContract.POLL_PATH_PREFIX + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new MediaExtractError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit 音频提取任务查询超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            MediaExtractError error = new MediaExtractError(
                    GenerationError.ERROR_PROVIDER_FAILED, "MediaKit 音频提取任务查询网络不可达");
            error.initCause(e);
            throw error;
        } catch (Exception e) {
            throw new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 音频提取任务查询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // HTTP 429/5xx 瞬时（cause 携带状态供 processor 重排）；4xx 业务错 → 硬失败
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                MediaExtractError error = new MediaExtractError(code,
                        "MediaKit 音频提取任务查询失败: HTTP " + response.code() + " body=" + truncate(rawText));
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);
            JsonNode data = unwrapData(parsed);

            String status = textOrNull(data, "status");
            if (status == null) {
                throw new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                        "MediaKit 音频提取任务响应缺少 status");
            }
            String normalized = status.toLowerCase();

            if ("failed".equals(normalized)) {
                // 上游错误信号：error 对象（提交响应同形状）与顶层 message 都读、取非空合并
                JsonNode rawError = data.has("error") && data.get("error").isObject()
                        ? data.get("error") : parsed.get("error");
                String upstreamCode = rawError != null && rawError.has("code")
                        ? rawError.get("code").asText() : null;
                String upstreamMessage = extractUpstreamMessage(rawText);
                return new ExtractAudioTaskObservation("failed", null, null,
                        upstreamCode, upstreamMessage);
            }

            if ("completed".equals(normalized)) {
                JsonNode audioUrl = data.path("result").path("audio_url");
                JsonNode duration = data.path("result").path("duration");
                return new ExtractAudioTaskObservation("succeeded",
                        audioUrl.isTextual() ? audioUrl.asText() : null,
                        duration.isNumber() ? duration.asDouble() : null,
                        null, null);
            }

            // queued / running 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
            return new ExtractAudioTaskObservation("processing", null, null, null, null);
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit 音频提取任务响应解析失败: " + e.getMessage());
        }
    }

    // ========== 内部工具 ==========

    private JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractContract.ERROR_MEDIA_EXTRACT_PROVIDER_FAILED,
                    "MediaKit 未返回有效 JSON");
        }
    }

    /** data 解包（网关可能包 data 层；非对象形态回退顶层，去字幕客户端同款）。 */
    private static JsonNode unwrapData(JsonNode parsed) {
        return parsed.has("data") && parsed.get("data").isObject() ? parsed.get("data") : parsed;
    }

    /**
     * 提取上游可读失败原因（error.message 或顶层 message 字段，两层都读取非空）。
     * 供应商原因透传给前端投影（§18.4 失败段）。
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
    ) {}
}
