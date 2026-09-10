package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * new-api 视频生成客户端（new-api-generation-ops.ts:243-327 + new-api-video-task-provider.ts 逐字移植）。
 * <p>
 * 端点：
 * <ul>
 *   <li>submit：POST /v1/video/generations（30s 超时，视频上游慢 :50-51）</li>
 *   <li>poll：GET /v1/video/generations/{taskId}（10s 超时，默认值）</li>
 * </ul>
 * <p>
 * 请求头（契约 §5 / ADR-0080）：
 * Authorization: Bearer per-job 解封凭证、X-Trace-Id、X-Client-System: bluewhale。
 * <p>
 * 响应形状：
 * <ul>
 *   <li>submit：{data:{task_id,status}} 或顶层 {task_id,status}（:250-266）</li>
 *   <li>poll：{data:{task_id,status,url,result_url,quota,error}} 或顶层（:269-327）</li>
 * </ul>
 * <p>
 * 状态映射（new-api-video-task-provider.ts:16-17）：
 * <ul>
 *   <li>SUCCESS_STATUSES = {success, succeeded, completed} → "succeeded"</li>
 *   <li>FAILED_STATUSES = {failed, failure, error, cancelled, canceled} → "failed"</li>
 *   <li>queued → "queued"，其余 → "processing"</li>
 * </ul>
 * <p>
 * 错误分类（new-api-video-task-provider.ts:22-37 toVideoProviderError）：
 * content > quota > provider_failed（§5 IKDAJN 优先级）。
 * <p>
 * <b>修正一</b>：quota 字段透传但不参与结算（actual_amount_fen 删除，video-job-runner.ts:317-339
 * 偏差告警段整体省略）；observation.quota 保留供将来恢复。
 */
public class NewApiVideoClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiVideoClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** submit 超时 30s（new-api-video-task-provider.ts:50-51）。 */
    private static final int SUBMIT_TIMEOUT_MS = 30_000;
    /** poll 超时 10s（默认）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    private static final Map<String, Boolean> SUCCESS_STATUSES = Map.of(
            "success", true, "succeeded", true, "completed", true);
    private static final Map<String, Boolean> FAILED_STATUSES = Map.of(
            "failed", true, "failure", true, "error", true,
            "cancelled", true, "canceled", true);

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;

    public NewApiVideoClient(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("NEW_API_BASE_URL 未配置");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");

        this.submitClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(SUBMIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .writeTimeout(SUBMIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build();

        this.pollClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(POLL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .writeTimeout(POLL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build();
    }

    /** 测试用构造器：注入共享 httpClient。 */
    NewApiVideoClient(String baseUrl, OkHttpClient sharedClient) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("NEW_API_BASE_URL 未配置");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.submitClient = sharedClient;
        this.pollClient = sharedClient;
    }

    /**
     * 提交视频生成任务（new-api-generation-ops.ts:242-267）。
     * <p>
     * POST /v1/video/generations，body 含 metadata.content 数组（首尾帧 + 参考）。
     *
     * @return {taskId, status}
     * @throws VideoProviderError 分类后错误码
     */
    public SubmitResult submit(String token, VideoSubmitInput input) {
        String traceId = UUID.randomUUID().toString();

        // 构建 metadata.content（new-api-generation-ops.ts:184-227）
        ArrayNode content = JSON.createArrayNode();
        if (input.firstFrameImage() != null) {
            content.add(buildContentItem("image_url", input.firstFrameImage(), "first_frame"));
        }
        if (input.lastFrameImage() != null) {
            content.add(buildContentItem("image_url", input.lastFrameImage(), "last_frame"));
        }
        for (VideoReference ref : input.references()) {
            String typeKey = switch (ref.type()) {
                case "image" -> "image_url";
                case "audio" -> "audio_url";
                default -> "video_url";
            };
            String role = switch (ref.type()) {
                case "image" -> "reference_image";
                case "audio" -> "reference_audio";
                default -> "reference_video";
            };
            content.add(buildContentItem(typeKey, ref.url(), role));
        }

        // 构建 body（new-api-generation-ops.ts:229-240）
        ObjectNode metadata = JSON.createObjectNode();
        metadata.put("duration", input.duration());
        if (input.resolution() != null) metadata.put("resolution", input.resolution());
        if (input.ratio() != null) metadata.put("ratio", input.ratio());
        metadata.set("content", content);

        ObjectNode body = JSON.createObjectNode();
        body.put("model", input.model());
        body.put("prompt", input.prompt());
        body.put("duration", input.duration());
        body.put("response_format", "url");
        body.set("metadata", metadata);

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(body);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        Request request = new Request.Builder()
                .url(baseUrl + "/v1/video/generations")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Authorization", "Bearer " + token)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale")
                .header("Content-Type", "application/json")
                .build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            // submit 超时 → provider_failed（runner catch 归类，video-job-runner.ts:357-375）
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交超时");
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                throw new VideoProviderError(code,
                        "new-api 视频提交失败: " + response.code());
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                // invalid_json_response → 持久错误（isTransientPollError 排除项，但 submit 阶段直接 fail）
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 视频提交响应非 JSON");
            }

            // data 解包（new-api-generation-ops.ts:250-253）
            JsonNode data = parsed.has("data") && parsed.get("data").isObject()
                    ? parsed.get("data") : parsed;

            // task_id 或 id（:254）
            String taskId = textOrNull(data, "task_id");
            if (taskId == null) taskId = textOrNull(data, "id");
            if (taskId == null || taskId.isEmpty()) {
                // invalid_video_response（:256-262）
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 视频提交响应缺少 task_id");
            }

            String status = textOrNull(data, "status");
            return new SubmitResult(taskId, status != null ? status : "queued");
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交解析失败: " + e.getMessage());
        }
    }

    /**
     * 轮询视频任务状态（new-api-generation-ops.ts:269-327 getVideoTask）。
     * <p>
     * GET /v1/video/generations/{taskId}
     *
     * @return 观测结果（status + progress + url + quota + error）
     * @throws VideoProviderError 网络/解析错误
     */
    public VideoTaskObservation poll(String token, String taskId) {
        String traceId = UUID.randomUUID().toString();

        Request request = new Request.Builder()
                .url(baseUrl + "/v1/video/generations/" + encodePath(taskId))
                .get()
                .header("Authorization", "Bearer " + token)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale")
                .build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            // 网络超时 → 上抛让 runner 判断 isTransientPollError
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "new-api 视频轮询超时");
        } catch (java.net.ConnectException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询网络不可达");
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                // HTTP 错误码 → runner isTransientPollError 判定
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                throw new VideoProviderError(code,
                        "new-api 视频轮询失败: " + response.code(),
                        new HttpStatusException(response.code()));
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                // invalid_json_response → 持久错误（isTransientPollError 排除项）
                throw new VideoProviderError("invalid_json_response",
                        "new-api 视频任务响应非 JSON");
            }

            // data 解包（:278-280）
            JsonNode data = parsed.has("data") && parsed.get("data").isObject()
                    ? parsed.get("data") : parsed;

            String responseTaskId = textOrNull(data, "task_id");
            if (responseTaskId == null) responseTaskId = textOrNull(data, "id");
            String status = textOrNull(data, "status");

            if (responseTaskId == null || status == null) {
                // invalid_video_response（:284-292）→ 持久错误
                throw new VideoProviderError("invalid_video_response",
                        "new-api 视频任务响应无效");
            }

            // error 解析（:294-310）
            JsonNode rawError = data.get("error");
            TaskError taskError = null;
            if (rawError != null && rawError.isObject()) {
                Object errCode = rawError.has("code") && (rawError.get("code").isTextual() || rawError.get("code").isNumber())
                        ? (rawError.get("code").isTextual() ? rawError.get("code").asText() : rawError.get("code").asText()) : null;
                String errMsg = rawError.has("message") && rawError.get("message").isTextual()
                        ? rawError.get("message").asText() : "视频生成失败";
                taskError = new TaskError(errCode != null ? errCode.toString() : null, errMsg);
            }

            // quota（:312，IK7G9X）
            Double quota = data.has("quota") && data.get("quota").isNumber()
                    ? data.get("quota").asDouble() : null;

            // url / result_url（:316-321）
            String url = textOrNull(data, "url");
            if (url == null) url = textOrNull(data, "result_url");

            // 状态映射（new-api-video-task-provider.ts:74-115）
            String normalizedStatus = status.toLowerCase();

            if (SUCCESS_STATUSES.containsKey(normalizedStatus)) {
                return new VideoTaskObservation("succeeded", 100, url, quota, null);
            }
            if (FAILED_STATUSES.containsKey(normalizedStatus)) {
                // 错误码分类（new-api-video-task-provider.ts:91-97）
                String upstreamCode = taskError != null ? taskError.code() : null;
                String upstreamText = (upstreamCode != null ? upstreamCode : "") + " "
                        + (taskError != null ? taskError.message() : "");
                String code;
                if (NewApiErrorClassifier.isContentPolicySignal(upstreamText)) {
                    code = GenerationError.ERROR_CONTENT_REJECTED;
                } else if (NewApiErrorClassifier.isQuotaSignal(upstreamText)) {
                    code = GenerationError.ERROR_QUOTA_EXHAUSTED;
                } else {
                    code = upstreamCode != null ? upstreamCode : GenerationError.ERROR_PROVIDER_FAILED;
                }
                return new VideoTaskObservation("failed", 100, null, quota,
                        new TaskError(code, taskError != null ? taskError.message() : "视频生成失败"));
            }

            // queued / processing（:109-115）
            String obsStatus = "queued".equals(normalizedStatus) ? "queued" : "processing";
            return new VideoTaskObservation(obsStatus, 0, null, quota, null);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询解析失败: " + e.getMessage());
        }
    }

    // ========== 工具方法 ==========

    private ObjectNode buildContentItem(String typeKey, String url, String role) {
        ObjectNode item = JSON.createObjectNode();
        item.put("type", typeKey);
        ObjectNode urlObj = JSON.createObjectNode();
        urlObj.put("url", url);
        urlObj.put("role", role);
        item.set(typeKey, urlObj);
        item.put("role", role);
        return item;
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && v.isTextual()) ? v.asText() : null;
    }

    private static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    /**
     * 提取 HTTP status 用于 isTransientPollError 判定。
     * VideoProviderError 携带 cause → runner 读 HttpStatusException.status。
     */
    public static class HttpStatusException extends Exception {
        private final int status;
        public HttpStatusException(int status) { super("HTTP " + status); this.status = status; }
        public int getStatus() { return status; }
    }

    /** 提交结果（new-api-generation-ops.ts:263-266）。 */
    public record SubmitResult(String taskId, String status) {}

    /**
     * 轮询观测（video-job-runner.ts:96-103 VideoTaskObservation 逐字移植）。
     * status: queued | processing | succeeded | failed
     */
    public record VideoTaskObservation(
            String status,
            int progress,
            String url,
            Double quota,
            TaskError error
    ) {}

    /** 任务错误（new-api-generation-ops.ts:294-310）。 */
    public record TaskError(String code, String message) {}

    /**
     * 视频提交输入（new-api-generation-ops.ts:176-240 body 字段）。
     * 由 VideoJobProcessor.buildSubmitRequest 组装。
     */
    public record VideoSubmitInput(
            String model,
            String prompt,
            double duration,
            String resolution,
            String ratio,
            String firstFrameImage,
            String lastFrameImage,
            List<VideoReference> references
    ) {}

    /**
     * 视频参考素材（video-job-runner.ts:81-87 VideoReference 逐字移植）。
     * type: image | video | audio
     */
    public record VideoReference(String type, String url) {}
}
