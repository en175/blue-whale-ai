package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
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
 *   <li>submit：POST /v1/video/generations（120s 超时：带视频参考的提交网关实测 ~51s 同步返回，IKJ80M）</li>
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

    /**
     * submit 超时 120s（IKJ80M）：网关处理带 video_url 参考的提交实测 ~51s 才同步返回，
     * 旧值 30s（new-api-video-task-provider.ts:50-51）会误杀视频参考任务；120s 留足余量。
     */
    private static final int SUBMIT_TIMEOUT_MS = 120_000;
    /** poll 超时 10s（默认）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    /** TEMP FIX（2026-09-22）：doubao-seedance-2-5 系模型名前缀，仅用于下面的线上临时兜底。 */
    static final String SEEDANCE_25_MODEL_PREFIX = "doubao-seedance-2-5";

    private static final Map<String, Boolean> SUCCESS_STATUSES = Map.of(
            "success", true, "succeeded", true, "completed", true);
    private static final Map<String, Boolean> FAILED_STATUSES = Map.of(
            "failed", true, "failure", true, "error", true,
            "cancelled", true, "canceled", true);

    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;
    private final String baseUrl;

    public NewApiVideoClient(UpstreamBaseUrl baseUrl) {
        this.baseUrl = baseUrl.normalized();
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
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
            // IKDJNZ：单数组 references 的帧条目自带 first_frame/last_frame；普通参考无 role，按 type 推导。
            String role = ref.role() != null ? ref.role() : switch (ref.type()) {
                case "image" -> "reference_image";
                case "audio" -> "reference_audio";
                default -> "reference_video";
            };
            content.add(buildContentItem(typeKey, ref.url(), role));
        }

        // ===== TEMP FIX 线上临时兜底（2026-09-22，待正式方案落地后删除）=====
        // 现象：doubao-seedance-2-5 系带参考视频时，上游按提示词把任务判为「视频编辑」，
        // 出参比例/时长须跟随被编辑的输入视频，故强制要求 ratio=adaptive、duration=-1，
        // 否则回 provider_failed（"`ratio` must be `adaptive` / `duration` must be -1"）。
        // 上游按提示词分类，我们按关键词分类（resolveVideoTaskType），两者必然有错位；
        // 这里对上游分类结果做事后追认。**正式方案**应在接纳侧冻结快照前按 taskType 决定
        // 并落到能力行字段，届时删除本块。
        boolean seedance25VideoEdit = input.model().startsWith(SEEDANCE_25_MODEL_PREFIX)
                && hasVideoReference(input.references());
        double effectiveDuration = seedance25VideoEdit ? -1 : input.duration();
        String effectiveRatio = seedance25VideoEdit ? "adaptive" : input.ratio();

        // 构建 body（new-api-generation-ops.ts:229-240）
        ObjectNode metadata = JSON.createObjectNode();
        metadata.put("duration", effectiveDuration);
        if (input.resolution() != null) metadata.put("resolution", input.resolution());
        if (effectiveRatio != null) metadata.put("ratio", effectiveRatio);
        // IKG0LP：用户选的「是否带音频」，缺省 true；仅能力位允许时接纳侧才会冻结进快照。
        // 契约：docs/specs/2026-09-15-ikg0lp-video-generate-audio-contract.md
        if (input.generateAudio() != null) metadata.put("generate_audio", input.generateAudio());
        metadata.set("content", content);

        ObjectNode body = JSON.createObjectNode();
        body.put("model", input.model());
        body.put("prompt", input.prompt());
        body.put("duration", effectiveDuration);
        body.put("response_format", "url");
        // IKIZQ8：样片（Draft）标记——网关读顶层 draft（或 metadata.draft）开启 480p
        // Draft 语义并强制 resolution=480p（IKIZBR 网关研究：adaptor.go draft.go）。
        if (input.draft()) {
            body.put("draft", true);
        }
        body.set("metadata", metadata);

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(body);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/video/generations")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            // submit 超时 → provider_failed（runner catch 归类，video-job-runner.ts:357-375）。
            // IKJ80P：cause 必须带上——网关超时断开后仍可能完成建单（provider_task_id 无从取得），
            // processor 据此把本 job 标记为「疑似上游已建单孤儿」落显式终态 + 告警。
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交超时", e);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 视频提交失败: HTTP " + response.code() + " body=" + truncated);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                // invalid_json_response → 持久错误（isTransientPollError 排除项，但 submit 阶段直接 fail）
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 视频提交响应非 JSON");
            }

            return parseSubmitResult(parsed);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频提交解析失败: " + e.getMessage());
        }
    }

    /**
     * IKIZQC：提交成片（finalize）任务——POST /v1/videos/{样片公开任务ID}/finalize。
     *
     * <p>网关（IKIZBR 固定提交研究）按**当前用户的公开样片任务 ID** 取原样片、锁定原渠道、
     * 校验 Draft/成功/7 天窗口，再从私有字段取上游 Draft ID 组装
     * {@code content:[{type:"draft_task",draft_task:{id:…}}]}——**提示词、素材、时长、
     * 比例、音频设置一律不能由这一步改写**，本仓也不持有上游 Draft ID。请求体只显式声明
     * 分辨率 1080p（网关校验显式分辨率只能取该值；空体同样合法，显式写出便于钉桩对账）。
     *
     * <p>响应形状与 submit 同构（网关把上游 id 改写为公开 task_xxx 放在 id/task_id），
     * 复用 {@link #parseSubmitResult}。返回的公开任务 ID 即成片轮询句柄（poll 复用）。
     *
     * @param sampleTaskId 来源样片的**网关公开**任务 ID（generation_jobs.provider_task_id）
     */
    public SubmitResult finalize(String token, String sampleTaskId) {
        String traceId = UUID.randomUUID().toString();

        ObjectNode body = JSON.createObjectNode();
        body.put("resolution", "1080p");

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(body);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/videos/" + encodePath(sampleTaskId) + "/finalize")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = submitClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交超时");
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody respBody = response.body();
            String rawText = respBody != null ? respBody.string() : "";

            if (!response.isSuccessful()) {
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 成片提交失败: HTTP " + response.code() + " body=" + truncated);
            }

            JsonNode parsed;
            try {
                parsed = JSON.readTree(rawText);
            } catch (Exception e) {
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "new-api 成片提交响应非 JSON");
            }

            return parseSubmitResult(parsed);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 成片提交解析失败: " + e.getMessage());
        }
    }

    /** submit / finalize 共用的提交响应解析：data 解包 → task_id∨id → status（缺省 queued）。 */
    private static SubmitResult parseSubmitResult(JsonNode parsed) {
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

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/v1/video/generations/" + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

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
                String truncated = rawText.length() > 300 ? rawText.substring(0, 300) + "…" : rawText;
                throw new VideoProviderError(code,
                        "new-api 视频轮询失败: HTTP " + response.code() + " body=" + truncated,
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

            // error 解析（:294-310）。
            // IKFL53：兼容两层信封——旧 new-api 在顶层带 fail_reason（tasks 表 FAILURE 的终端错误），
            // 新响应把 error 对象放 data.error。两处都读、取非空合并，避免因 error 放哪层而丢分类信号。
            JsonNode rawError = data.has("error") && data.get("error").isObject() ? data.get("error") : null;
            if (rawError == null && parsed.has("error") && parsed.get("error").isObject()) {
                rawError = parsed.get("error");
            }
            TaskError taskError = null;
            if (rawError != null) {
                String errCode = nodeTextOrNull(rawError, "code");
                String errMsg = nodeTextOrNull(rawError, "message");
                taskError = new TaskError(errCode, errMsg != null ? errMsg : "视频生成失败");
            }
            // fail_reason（顶层优先，IKFL53）：new-api tasks 表 FAILURE 状态把终端错误放这。
            String failReason = firstTextOrNull(parsed, data, "fail_reason");

            // quota（:312，IK7G9X）
            Double quota = data.has("quota") && data.get("quota").isNumber()
                    ? data.get("quota").asDouble() : null;

            // 上游真实 token 数（结算的**权威**用量，见 usage.proto 的 USAGE_SOURCE_UPSTREAM）。
            // 实测（2026-09-25，task_FIwJhbur…，doubao-seedance-2-0-fast 480p 16:9 4s）：
            //   {"data":{"usage":{"total_tokens":40594,"completion_tokens":40594},
            //            "data":{"usage":{"total_tokens":40594,...}}}}
            // 即**外层信封与内层任务结果各带一份**，取值以外层优先。
            Long totalTokens = extractTotalTokens(data);

            // IKIZQ8：可信上游 Draft created_at（epoch 毫秒）——转成片截止的起算点
            // （IKIZKG：网关 SubmitTime 晚于它，不能替代）。取不到 = null：样片仍交付，
            // 但 finalize_deadline 为 null ⇒ 服务端禁用成片。候选位置与 totalTokens 同款：
            // 外层信封 data.created_at 与内层上游任务回显 data.data.created_at，先外后内。
            Long upstreamCreatedAtMs = extractUpstreamCreatedAtMs(data);

            // url / result_url（:316-321）
            String url = textOrNull(data, "url");
            if (url == null) url = textOrNull(data, "result_url");

            // 状态映射（new-api-video-task-provider.ts:74-115）
            String normalizedStatus = status.toLowerCase();

            if (SUCCESS_STATUSES.containsKey(normalizedStatus)) {
                return new VideoTaskObservation("succeeded", 100, url, quota, null, totalTokens,
                        upstreamCreatedAtMs);
            }
            if (FAILED_STATUSES.containsKey(normalizedStatus)) {
                // 错误码分类（new-api-video-task-provider.ts:91-97）。
                // IKFL53：信号源 = data.error（code+message）+ fail_reason 全文，缺一补一。
                String upstreamCode = taskError != null ? taskError.code() : null;
                String message = taskError != null && taskError.message() != null
                        ? taskError.message() : (failReason != null ? failReason : "视频生成失败");
                String upstreamText = (upstreamCode != null ? upstreamCode : "") + " "
                        + (failReason != null ? failReason : "") + " "
                        + (taskError != null && taskError.message() != null ? taskError.message() : "");
                String code;
                if (NewApiErrorClassifier.isOutputAudioCopyrightSignal(upstreamText)) {
                    // IKJ8J8：输出侧音频版权（官方码 OutputAudioSensitiveContentDetected）→ 1059
                    // 精确码，先于版权关键词判定——官方错误码名比关键词更确证（ADR-0119）。
                    code = GenerationError.ERROR_CONTENT_REJECTED_AUDIO;
                } else if (NewApiErrorClassifier.isCopyrightSignal(upstreamText)) {
                    // IKFL53：版权拒绝 → 1038 中性兜底（先于输出/敏感判定；IKJ8J8 起文案不再宣称「参考内容」）。
                    code = GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
                } else if (NewApiErrorClassifier.isContentPolicySignal(upstreamText)) {
                    code = GenerationError.ERROR_CONTENT_REJECTED;
                } else if (NewApiErrorClassifier.isQuotaSignal(upstreamText)) {
                    code = GenerationError.ERROR_QUOTA_EXHAUSTED;
                } else {
                    code = upstreamCode != null ? upstreamCode : GenerationError.ERROR_PROVIDER_FAILED;
                }
                return new VideoTaskObservation("failed", 100, null, quota,
                        new TaskError(code, message), totalTokens, upstreamCreatedAtMs);
            }

            // queued / processing（:109-115）
            String obsStatus = "queued".equals(normalizedStatus) ? "queued" : "processing";
            return new VideoTaskObservation(obsStatus, 0, null, quota, null, totalTokens,
                    upstreamCreatedAtMs);
        } catch (VideoProviderError e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "new-api 视频轮询解析失败: " + e.getMessage());
        }
    }

    /**
     * 从轮询响应里取上游真实 token 数。
     *
     * <p><b>取不到 = null，不是 0</b>：null 让上报侧「干脆不报这个维度」，
     * 结算退回按预扣额计价并留痕；报 0 则是一笔货真价实的「免费生成」。
     *
     * <p>三处形状都认，按可信度取第一个非空：
     * <ol>
     *   <li>外层信封 {@code data.usage.total_tokens}（实测在的位置）</li>
     *   <li>内层任务结果 {@code data.data.usage.total_tokens}（上游回显，与外层同值）</li>
     *   <li>上面两处的 {@code completion_tokens} 兜底 —— 视频任务实测
     *       {@code total_tokens == completion_tokens}，任缺一个都还能拿到数</li>
     * </ol>
     *
     * <p>另兼容 {@code usage_total_tokens} 扁平写法（ADR-0063 记的 new-api Task 信封形态，
     * 当时 token 字段不带 {@code usage} 对象）。两种形态都在线上出现过，
     * 只认一种就会静默丢 token —— 而那是钱。
     *
     * <p>值可能是字符串（上游 {@code flexInt} 序列化），所以文本与数值都读。
     */
    private static Long extractTotalTokens(JsonNode data) {
        JsonNode inner = data.has("data") && data.get("data").isObject() ? data.get("data") : null;
        for (JsonNode node : new JsonNode[]{data, inner}) {
            if (node == null) continue;
            JsonNode usage = node.get("usage");
            Long fromObject = usage != null && usage.isObject()
                    ? firstToken(usage, "total_tokens", "completion_tokens") : null;
            if (fromObject != null) return fromObject;
            Long fromFlat = firstToken(node, "usage_total_tokens", "usage_completion_tokens");
            if (fromFlat != null) return fromFlat;
        }
        return null;
    }

    /** 按序取第一个可解析为整数的 token 字段。 */
    private static Long firstToken(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value == null) continue;
            Long parsed = null;
            if (value.isNumber()) {
                parsed = value.asLong();
            } else if (value.isTextual()) {
                try {
                    parsed = Long.parseLong(value.asText().trim());
                } catch (NumberFormatException ignored) {
                    // 非数字文本 = 这个字段不可用，继续看下一个（缺省/非法兜底不 panic）
                }
            }
            if (parsed != null && parsed > 0) {
                return parsed;
            }
        }
        return null;
    }

    /**
     * IKIZQ8：从轮询响应取可信上游 Draft created_at（epoch 毫秒）。
     *
     * <p><b>取不到 = null，不是 0</b>：null 让样片以「缺可信时间」交付（deadline 为
     * null、成片禁用），与 {@link #extractTotalTokens} 的「不报该维度」同口径。
     *
     * <p>候选位置（先外后内，与 token 提取同一信封假设）：
     * <ol>
     *   <li>外层信封 {@code data.created_at}（网关 DTO 若透传）</li>
     *   <li>内层上游任务回显 {@code data.data.created_at}（Ark 任务对象，实测
     *       {@code usage} 就住在这里）</li>
     * </ol>
     *
     * <p>Ark 的 {@code created_at} 是 **Unix 秒**；兼容毫秒（13 位）与字符串形态
     * （上游 flexInt 序列化）。秒/毫秒按数量级判别：&lt; 10^12 视为秒并放大。
     */
    private static Long extractUpstreamCreatedAtMs(JsonNode data) {
        JsonNode inner = data.has("data") && data.get("data").isObject() ? data.get("data") : null;
        for (JsonNode node : new JsonNode[]{data, inner}) {
            if (node == null) continue;
            Long raw = firstToken(node, "created_at", "created_at_ms");
            if (raw == null || raw <= 0) continue;
            return raw < 1_000_000_000_000L ? raw * 1000 : raw;
        }
        return null;
    }

    // ========== 工具方法 ==========

    /** TEMP FIX（2026-09-22）：references 中是否存在「参考视频」（首尾帧为 image，type 不混淆）。 */
    private static boolean hasVideoReference(List<VideoReference> references) {
        for (VideoReference ref : references) {
            if ("video".equals(ref.type())) return true;
        }
        return false;
    }

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

    /** 节点内字段取文本（textual/数值都可读，IKFL53 防 code 解析失败丢信号）。 */
    private static String nodeTextOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null) return null;
        if (v.isTextual()) return v.asText();
        if (v.isNumber()) return v.asText();
        return null;
    }

    /** 从多个节点中按序取第一个文本字段（fail_reason 顶层优先，IKFL53）。 */
    private static String firstTextOrNull(JsonNode primary, JsonNode secondary, String field) {
        String v = textOrNull(primary, field);
        return v != null ? v : textOrNull(secondary, field);
    }

    private static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    /**
     * 提取 HTTP status 用于 isTransientPollError 判定。
     * VideoProviderError 携带 cause → runner 读 HttpStatusException.status。
     * <p>
     * 实现共享模块的 {@link NewApiHttpSupport.HttpStatusCarrier}：状态解析器
     * {@code NewApiHttpSupport.upstreamHttpStatus} 随装配类上移到 blue-whale-common，
     * 不能再 instanceof 本类（反向依赖编译不过），故以接口钉契约。
     */
    public static class HttpStatusException extends Exception
            implements NewApiHttpSupport.HttpStatusCarrier {
        private final int status;
        public HttpStatusException(int status) { super("HTTP " + status); this.status = status; }
        @Override
        public int getStatus() { return status; }
    }

    /** 提交结果（new-api-generation-ops.ts:263-266）。 */
    public record SubmitResult(String taskId, String status) {}

    /**
     * 轮询观测（video-job-runner.ts:96-103 VideoTaskObservation 逐字移植）。
     * status: queued | processing | succeeded | failed
     *
     * @param totalTokens 上游报的**真实 token 数**（成功终态才可能有）。
     *        {@code null} = 这次响应里没有可用 token —— 上报侧据此**不报**这个维度，
     *        结算退回按预扣额计价；**不要填 0**（0 是一笔免费生成，会静默少收）。
     *        取值与回退顺序见 {@link #extractTotalTokens}
     * @param upstreamCreatedAtMs IKIZQ8：可信上游 Draft created_at（epoch 毫秒，样片
     *        截止的起算点）。{@code null} = 响应里没有——样片仍交付但 finalize_deadline
     *        为 null（成片禁用）。取值位置见 {@link #extractUpstreamCreatedAtMs}
     */
    public record VideoTaskObservation(
            String status,
            int progress,
            String url,
            Double quota,
            TaskError error,
            Long totalTokens,
            Long upstreamCreatedAtMs
    ) {
        /** 既有 6 参形态：无可信 created_at（普通视频 / 旧用例），created_at 缺省 null。 */
        public VideoTaskObservation(
                String status, int progress, String url, Double quota, TaskError error, Long totalTokens) {
            this(status, progress, url, quota, error, totalTokens, null);
        }
    }

    /** 任务错误（new-api-generation-ops.ts:294-310）。 */
    public record TaskError(String code, String message) {}

    /**
     * 视频提交输入（new-api-generation-ops.ts:176-240 body 字段）。
     * 由 VideoJobProcessor.buildSubmitRequest 组装。
     *
     * @param draft IKIZQ8：样片（480p Draft）标记——input 快照冻结的 sample_mode=true。
     *        true 时提交体带顶层 {@code draft: true}，网关转 Draft 并强制 480p。
     */
    public record VideoSubmitInput(
            String model,
            String prompt,
            double duration,
            String resolution,
            String ratio,
            String firstFrameImage,
            String lastFrameImage,
            List<VideoReference> references,
            /** IKG0LP：视频是否带音频。null = 不下发该字段（能力位不允许或旧快照），维持上游默认。 */
            Boolean generateAudio,
            boolean draft
    ) {
        /** 普通视频（非样片）的既有 9 参形态：draft 缺省 false，旧调用点零改动。 */
        public VideoSubmitInput(
                String model, String prompt, double duration, String resolution, String ratio,
                String firstFrameImage, String lastFrameImage,
                List<VideoReference> references, Boolean generateAudio) {
            this(model, prompt, duration, resolution, ratio, firstFrameImage, lastFrameImage,
                    references, generateAudio, false);
        }
    }

    /**
     * 视频参考素材（video-job-runner.ts:81-87 VideoReference 逐字移植）。
     * type: image | video | audio
     * <p>
     * role：单数组 references 语义下帧条目带 first_frame/last_frame（IKDJNZ）；普通参考为 null，
     * 提交时按 type 推导 reference_image/reference_video/reference_audio。
     */
    public record VideoReference(String type, String url, String role) {

        /** 无显式 role 的普通参考：提交时按 type 推导默认角色。 */
        public VideoReference(String type, String url) {
            this(type, url, null);
        }
    }
}
