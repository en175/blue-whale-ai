package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import com.fasterxml.jackson.databind.JsonNode;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.util.Map;
import java.util.UUID;

import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.JSON_TYPE;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.extractUpstreamMessage;
import static com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitJsonSupport.truncate;

/**
 * MediaKit 同步客户端家族共享模板（IKHKMK 收敛）。
 * <p>
 * 家族四个同步客户端（高清放大 / 智能扩图 / 图片抠图 / 图片擦除）的单次 POST 骨架
 * 逐字同构——消息文案按 {@link #taskLabel()} 拼接后四族完全一致。本基类吸收该骨架：
 * 序列化 → POST → 网络错误分类 → HTTP !2xx 分类链（§5 content &gt; quota &gt;
 * provider_failed，上游可读原因透传）→ error 信封分类 → result.image_url 提取。
 * <p>
 * 子类只填族特异参数（模板方法四个，均为单行）+ 出站 payload 构造 + result 附加
 * 字段解析（如抠图的宽高）：
 * <ul>
 *   <li>{@link #syncPath()}：网关同步路由（对客路径）</li>
 *   <li>{@link #taskLabel()}：消息文案族名（骨架错误消息逐字保持的唯一变化点）</li>
 *   <li>{@link #fallbackCode()}：契约兜底错误码（响应形状异常 / 解析失败时抛）</li>
 *   <li>{@link #error(String, String)}：族领域错误构造（processor 按具体类型 catch 不变）</li>
 * </ul>
 * <p>
 * 超时是族变化轴（env 名与默认值各族不同），由子类解析后经构造器传入——基类不塌缩
 * （刀③ NewApiHttpSupport 同款口径）。鉴权头 / baseUrl / OkHttp 装配复用
 * {@link NewApiHttpSupport}，无类型 JSON 工具复用 {@link NewApiMediaKitJsonSupport}。
 */
abstract class NewApiMediaKitSyncClient {

    protected final String baseUrl;
    private final OkHttpClient httpClient;

    protected NewApiMediaKitSyncClient(String baseUrl, int timeoutMs) {
        this.baseUrl = NewApiHttpSupport.normalizeBaseUrl(baseUrl);
        this.httpClient = NewApiHttpSupport.buildClient(10_000, timeoutMs, timeoutMs);
    }

    // ===== 子类填的族特异参数 =====

    /** 网关同步路由路径（blue-whale-api 网关侧 MediaKit 渠道）。 */
    protected abstract String syncPath();

    /** 消息文案族名（如「高清放大」）——骨架错误消息逐字保持的唯一变化点。 */
    protected abstract String taskLabel();

    /** 契约兜底错误码（响应形状异常 / 解析失败时抛，各族 Contract 常量）。 */
    protected abstract String fallbackCode();

    /** 族领域错误构造（保持各 processor catch 具体类型与getCode 语义不变）。 */
    protected abstract RuntimeException error(String code, String message);

    // ===== 同步 POST 骨架 =====

    /**
     * 执行同步 POST，过完整错误链后返回已解析的顶层 JSON（子类再做族特异的
     * result 提取；通用 result.image_url 用 {@link #requireResultImageUrl}）。
     * <p>
     * 骨架：序列化 → POST → 网络错误分类（超时统一终态不重试：宁可不重试也不双跑）→
     * HTTP !2xx 分类链（上游可读原因透传给前端投影）→ parse → error 信封分类。
     */
    protected JsonNode executeSyncPost(String token, Map<String, Object> payload) {
        String traceId = UUID.randomUUID().toString();
        String label = taskLabel();

        Request.Builder requestBuilder;
        try {
            requestBuilder = new Request.Builder()
                    .url(baseUrl + syncPath())
                    .post(RequestBody.create(JSON.writeValueAsString(payload), JSON_TYPE))
                    .header("Content-Type", "application/json");
        } catch (Exception e) {
            throw error(fallbackCode(), "请求序列化失败");
        }
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);
        Request request = requestBuilder.build();

        Response response;
        try {
            response = httpClient.newCall(request).execute();
        } catch (java.net.SocketTimeoutException e) {
            // 超时统一终态不重试（无 worker 级自动重试；宁可不重试也不双跑）
            throw error(GenerationError.ERROR_PROVIDER_TIMEOUT,
                    "MediaKit " + label + "超时");
        } catch (Exception e) {
            // 连接失败 / 其余 IO：请求可能未达上游，零扣费风险——仍归终态（无自动重试）
            throw error(GenerationError.ERROR_PROVIDER_FAILED,
                    "MediaKit " + label + "调用失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        try (response) {
            ResponseBody body = response.body();
            String rawText = body != null ? body.string() : "";

            if (!response.isSuccessful()) {
                // 网关对 success=false / 未配价 / 缺渠道返 400 且不扣费——
                // 分类沿用 §5（content > quota > provider_failed），上游可读原因透传给前端投影。
                String code = NewApiErrorClassifier.classifyError(rawText, response.code());
                String reason = extractUpstreamMessage(rawText);
                String message = label + "失败: HTTP " + response.code();
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
                throw error(code, "MediaKit " + label + "业务失败: " + truncate(errText));
            }
            return parsed;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw error(fallbackCode(),
                    "MediaKit 响应读取失败: " + e.getMessage());
        }
    }

    /** 通用结果图地址提取（result.image_url 非空校验，缺失抛契约兜底码）。 */
    protected String requireResultImageUrl(JsonNode parsed) {
        JsonNode resultUrl = parsed.path("result").path("image_url");
        if (!resultUrl.isTextual() || resultUrl.asText().isEmpty()) {
            throw error(fallbackCode(), "MediaKit 未返回结果图");
        }
        return resultUrl.asText();
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
