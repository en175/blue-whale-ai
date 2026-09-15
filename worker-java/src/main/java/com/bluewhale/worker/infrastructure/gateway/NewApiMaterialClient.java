package com.bluewhale.worker.infrastructure.gateway;

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

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * new-api 素材库客户端（worker 侧只用到 GetAsset；ADR-0087）。
 * <p>
 * 端点：POST {@code /api/material/GetAsset}，body {@code {"Id": "asset-..."}}。
 * 与 backend MaterialService.callAction 同一网关同一 Action，信封同构：
 * 成功 {@code {ResponseMetadata, Result:{Id,Status,Error?}}}，失败 {@code {ResponseError:{Code,Message}}}。
 * <p>
 * 请求头：标准三元组走 {@link NewApiHttpSupport}（Authorization: Bearer + X-Trace-Id +
 * X-Client-System: bluewhale）。
 * <p>
 * 与图片/视频/音频客户端的差异：本类<b>不在构造期校验 baseUrl</b>。定时跟进不是 tag 消费，
 * 没有 @Conditional 兜着——构造期抛错会把「WORKER_ENABLED_TAGS 为空」的安全拉起形态打挂。
 * 缺配置时改为每轮跳过 + 首次告警一次。
 */
@Component
public class NewApiMaterialClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMaterialClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /** GetAsset 是单次读，给足 15s 即可（超时按「查不到」处理，下轮重试）。 */
    private static final long CONNECT_TIMEOUT_MS = 10_000L;
    private static final long READ_TIMEOUT_MS = 15_000L;

    private final String baseUrl;
    private final OkHttpClient httpClient;
    /** 缺配置只告警一次（每 5s 一轮，避免刷屏）。 */
    private boolean missingBaseUrlLogged;

    public NewApiMaterialClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL（null/空 = 未配置形态）。 */
    public NewApiMaterialClient(String baseUrl) {
        this.baseUrl = baseUrl == null || baseUrl.isBlank()
                ? null
                : baseUrl.replaceAll("/+$", "");
        this.httpClient = NewApiHttpSupport.buildClient(
                CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS, READ_TIMEOUT_MS);
    }

    /**
     * 查单条素材的上游状态。
     *
     * @param token      该用户的 sk-（从 user_info 取回）
     * @param materialId 素材库素材 id（asset-...）
     * @return 解析出的状态；<b>任何查不到的情形（未配置 / 网络失败 / 非 2xx / 信封不合预期）
     *         一律返回 null</b>——调用方按「本轮未知，保持 Processing」处理，不误判为可用也不误判为失败
     * @throws IllegalArgumentException token 或 materialId 为空（调用方 bug，不该静默）
     */
    public MaterialStatusResult getAsset(String token, String materialId) {
        if (baseUrl == null) {
            if (!missingBaseUrlLogged) {
                missingBaseUrlLogged = true;
                log.warn("素材状态跟进跳过：NEW_API_BASE_URL 未配置");
            }
            return null;
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token 不能为空");
        }
        if (materialId == null || materialId.isBlank()) {
            throw new IllegalArgumentException("materialId 不能为空");
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("Id", materialId);

        String traceId = UUID.randomUUID().toString();
        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            log.error("GetAsset 请求序列化失败 materialId={}: {}", materialId, e.getMessage());
            return null;
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/api/material/GetAsset")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, traceId);

        String rawText;
        try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
            ResponseBody body = response.body();
            rawText = body != null ? body.string() : "";
            if (!response.isSuccessful()) {
                log.warn("GetAsset 非 2xx materialId={} HTTP {}", materialId, response.code());
                return null;
            }
        } catch (Exception e) {
            // 网络/超时：本轮未知。下一轮（5s 后）再试，窗口内共 10 分钟。
            log.warn("GetAsset 请求失败 materialId={}: {}", materialId, e.getMessage());
            return null;
        }

        return parseResult(rawText, materialId);
    }

    /**
     * 解析上游信封。任何不合预期的形状都返回 null（含上游只回 ResponseError 的情形）——
     * 状态未知就不写库，避免把一次坏响应固化成终态。
     */
    private MaterialStatusResult parseResult(String rawText, String materialId) {
        JsonNode parsed;
        try {
            parsed = JSON.readTree(rawText);
        } catch (Exception e) {
            log.warn("GetAsset 响应非 JSON materialId={}", materialId);
            return null;
        }
        JsonNode result = parsed.get("Result");
        if (result == null || !result.isObject()) {
            // 含 ResponseError 形态：错误码原文留给上层日志，不落库（不解释、不映射，ADR-0087 决策 6）。
            log.warn("GetAsset 响应无 Result materialId={}", materialId);
            return null;
        }
        JsonNode statusNode = result.get("Status");
        if (statusNode == null || !statusNode.isTextual() || statusNode.asText().isBlank()) {
            log.warn("GetAsset 响应缺 Status materialId={}", materialId);
            return null;
        }

        String errorCode = null;
        String errorMessage = null;
        JsonNode error = result.get("Error");
        if (error != null && error.isObject()) {
            JsonNode codeNode = error.get("Code");
            if (codeNode != null && codeNode.isTextual()) {
                errorCode = codeNode.asText();
            }
            JsonNode messageNode = error.get("Message");
            if (messageNode != null && messageNode.isTextual()) {
                errorMessage = messageNode.asText();
            }
        }
        return new MaterialStatusResult(statusNode.asText(), errorCode, errorMessage);
    }

    /**
     * 上游素材状态（原文透传，不做枚举收敛——收敛在调用方，见 MaterialStatusPoller）。
     *
     * @param status       上游 Status 原文
     * @param errorCode    上游 Error.Code 原文（可空）
     * @param errorMessage 上游 Error.Message 原文（可空）
     */
    public record MaterialStatusResult(String status, String errorCode, String errorMessage) {}
}
