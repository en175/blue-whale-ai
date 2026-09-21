package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import com.fasterxml.jackson.databind.JsonNode;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.net.SocketTimeoutException;
import java.util.Map;
import java.util.UUID;

import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON_TYPE;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.encodePath;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.extractUpstreamMessage;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.truncate;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.unwrapData;

/**
 * MediaKit 异步任务客户端家族共享模板（IKHKMK 收敛）。
 * <p>
 * 家族六个异步客户端（去字幕 / 音频提取 / 画质增强 / 场景切分 / 人声分离 / 音频截取）
 * 的 submit（POST 提交返 task_id）与 poll（GET 查询端点轮询）HTTP 骨架逐字同构——
 * 消息文案按 {@link #taskLabel()} 拼接后六族完全一致。本基类吸收该骨架：
 * 提交任务、轮询查询、错误分类链（§5 content &gt; quota &gt; provider_failed）、
 * HTTP 瞬时语义 cause 携带、status 小写归一、failed 分支的上游错误信号提取。
 * <p>
 * 子类只填族特异参数（模板方法五个，均为单行）+ 契约枚举校验 / 出站 payload 构造 /
 * completed 结果解析（Observation record 形状各族不同，留在子类）：
 * <ul>
 *   <li>{@link #submitPath()} / {@link #pollPathPrefix()}：网关对客路由（契约常量单源）</li>
 *   <li>{@link #taskLabel()}：消息文案族名（骨架错误消息逐字保持的唯一变化点）</li>
 *   <li>{@link #fallbackCode()}：契约兜底错误码（响应形状异常 / 解析失败时抛）</li>
 *   <li>{@link #error(String, String)}：族领域错误构造（processor 按具体类型 catch 不变）</li>
 * </ul>
 * <p>
 * 家族口径（行为与收敛前逐字一致）：submit 超时 30s / poll 超时 10s；提交超时归终态
 * 不重试（宁可不重试也不双跑）；poll 网络超时 / 连接失败 / HTTP 429/5xx 抛错时以
 * cause 携带状态（{@link NewApiVideoClient.HttpStatusException} 复用），供 processor
 * 按 isTransientPollError 语义判定瞬时重排；status 中间态枚举官方未逐字冻结，
 * 小写归一（completed→completed、failed→failed、其余由子类归 processing）。
 * 鉴权头 / baseUrl / OkHttp 装配复用 {@link NewApiHttpSupport}，无类型 JSON 工具
 * 复用 {@link NewApiMediaKitJsonSupport}。
 */
abstract class NewApiMediaKitAsyncTaskClient {

    /** submit 超时 30s（异步提交秒级入队，家族同窗口）。 */
    private static final int SUBMIT_TIMEOUT_MS = 30_000;

    /** poll 超时 10s（家族同窗口）。 */
    private static final int POLL_TIMEOUT_MS = 10_000;

    protected final String baseUrl;
    private final OkHttpClient submitClient;
    private final OkHttpClient pollClient;

    protected NewApiMediaKitAsyncTaskClient(String baseUrl) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.submitClient = NewApiHttpSupport.buildClient(10_000, SUBMIT_TIMEOUT_MS, SUBMIT_TIMEOUT_MS);
        this.pollClient = NewApiHttpSupport.buildClient(10_000, POLL_TIMEOUT_MS, POLL_TIMEOUT_MS);
    }

    // ===== 子类填的族特异参数 =====

    /** 网关异步提交路由（对客路径，契约常量单源；禁止写火山上游路径）。 */
    protected abstract String submitPath();

    /** 网关异步任务查询路由前缀（拼 taskId；MediaKit 异步工具共用同一条查询路由）。 */
    protected abstract String pollPathPrefix();

    /** 消息文案族名（如「去字幕」）——骨架错误消息逐字保持的唯一变化点。 */
    protected abstract String taskLabel();

    /** 契约兜底错误码（响应形状异常 / 解析失败时抛，各族 Contract 常量）。 */
    protected abstract String fallbackCode();

    /** 族领域错误构造（保持各 processor catch 具体类型与getCode 语义不变）。 */
    protected abstract RuntimeException error(String code, String message);

    // ===== submit 骨架 =====

    /**
     * 执行异步提交（官方「第 1 步：提交任务」：成功返回 task_id）。
     * <p>
     * 骨架：序列化 → POST → 网络错误分类 → HTTP !2xx 分类链（上游可读原因透传）→
     * error 信封分类 → data 解包 → task_id 提取。payload 构造与契约枚举校验在子类。
     */
    protected String executeSubmit(String token, Map<String, Object> payload) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            throw error(fallbackCode(), "请求序列化失败");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + submitPath())
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
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "提交超时");
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "提交失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 官方同步错误结构 error{code,message,param,type}（success=false 任务不创建）——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = label + "任务提交失败: HTTP " + response.code();
                if (!reason.isEmpty()) {
                    message += " " + reason;
                } else {
                    message += " body=" + truncate(rawText);
                }
                throw error(code, message);
            }

            JsonNode parsed = parseJsonOrThrow(rawText);

            JsonNode errorNode = parsed.get("error");
            if (errorNode != null && errorNode.has("message")) {
                String errText = errorNode.get("message").asText();
                String code = NewApiErrorClassifier.classifySuccessEnvelope(errText);
                throw error(code, "MediaKit " + label + "提交业务失败: " + truncate(errText));
            }

            // data 解包宽容（网关可能包 data 层，家族同款）
            JsonNode data = unwrapData(parsed);
            String taskId = NewApiMediaKitJsonSupport.textOrNull(data, "task_id");
            if (taskId == null || taskId.isEmpty()) {
                throw error(fallbackCode(),
                        "MediaKit " + label + "提交响应缺少 task_id");
            }
            return taskId;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(fallbackCode(),
                    "MediaKit " + label + "提交响应读取失败: " + e.getMessage());
        }
    }

    // ===== poll 骨架 =====

    /**
     * poll 已解包的响应信封：顶层 parsed + 网关 data 解包层（failed 分支的
     * 上游错误信号与 completed 的 result 都在 data 层读取）。
     */
    protected record PollBody(JsonNode parsed, JsonNode data) {}

    /**
     * 执行异步任务查询（官方「第 2 步：获取结果」：轮询至 completed / failed）。
     * <p>
     * 骨架：GET → 网络错误分类（瞬时语义 cause 携带）→ HTTP !2xx 分类链 →
     * parse → data 解包。status 三分支判定与 completed 结果解析在子类
     * （Observation record 形状各族不同）。
     */
    protected PollBody executePoll(String token, String taskId) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + pollPathPrefix() + encodePath(taskId))
                .get();
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = pollClient.newCall(request).execute();
        } catch (SocketTimeoutException e) {
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "任务查询超时");
        } catch (java.net.ConnectException | java.net.UnknownHostException e) {
            RuntimeException error = error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务查询网络不可达");
            error.initCause(e);
            throw error;
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务查询失败: " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // HTTP 429/5xx 瞬时（cause 携带状态供 processor 重排）；4xx 业务错 → 硬失败
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                RuntimeException error = error(code,
                        "MediaKit " + label + "任务查询失败: HTTP " + response.code() + " body=" + truncate(rawText));
                error.initCause(new NewApiVideoClient.HttpStatusException(response.code()));
                throw error;
            }

            JsonNode parsed = parseJsonOrThrow(rawText);
            return new PollBody(parsed, unwrapData(parsed));
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "任务响应解析失败: " + e.getMessage());
        }
    }

    /** poll 状态读取 + 小写归一（缺 status 抛 provider_failed；中间态枚举官方未冻结）。 */
    protected String normalizedStatus(PollBody body) {
        String status = NewApiMediaKitJsonSupport.textOrNull(body.data(), "status");
        if (status == null) {
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + taskLabel() + "任务响应缺少 status");
        }
        return status.toLowerCase();
    }

    /** failed 分支的上游 error.code（error 对象优先 data 解包层、回退顶层；可 null）。 */
    protected String extractUpstreamCode(PollBody body) {
        JsonNode rawError = body.data().has("error") && body.data().get("error").isObject()
                ? body.data().get("error") : body.parsed().get("error");
        return rawError != null && rawError.has("code")
                ? rawError.get("code").asText() : null;
    }

    /** failed 分支的上游可读原因（error.message / 顶层 message 两层取非空；可空串）。 */
    protected String extractPollUpstreamMessage(PollBody body) {
        for (JsonNode node : new JsonNode[] {body.data(), body.parsed()}) {
            JsonNode message = node.path("error").path("message");
            if (!message.isTextual() || message.asText().isEmpty()) {
                message = node.path("message");
            }
            if (message.isTextual() && !message.asText().isEmpty()) {
                return truncate(message.asText());
            }
        }
        return "";
    }

    // ===== 共享工具 =====

    /** 响应 JSON 解析（非法 JSON 抛契约兜底码）。 */
    protected JsonNode parseJsonOrThrow(String rawText) {
        try {
            return JSON.readTree(rawText);
        } catch (Exception e) {
            throw error(fallbackCode(), "MediaKit 未返回有效 JSON");
        }
    }
}
