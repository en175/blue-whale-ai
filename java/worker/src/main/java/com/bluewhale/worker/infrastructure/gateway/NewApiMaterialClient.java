package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.libs.http.NewApiHttpSupport;

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
 * 缺配置时每轮跳过 + 首次告警一次，不阻断跟进循环。
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
     * 上游错误码里表示「**这个素材本身**用不了」的那些——终局拒绝。
     * <p>
     * 2026-09-15 真网关实测：`DeleteAsset` 后 `GetAsset` 返回 `NotFound.asset_id`；
     * 格式非法的 id 返回 `InvalidParameter.AssetID`。两者重试一万次也不会变可用，
     * 所以按终态收敛，别让跟进器白追满 10 分钟窗口。
     * <p>
     * 保持窄：只认素材级的码。鉴权失败走的是另一套信封（`{"error":{...}}`，无 `ResponseError`），
     * 落不进这个正则；租户未开通 / 限流 / 5xx 都不是素材的错，必须保持「本轮未知」——
     * 否则一次账号级故障会把该用户所有在途素材误标成 Failed。
     */
    private static final java.util.regex.Pattern MATERIAL_LEVEL_REJECTION_CODE =
            java.util.regex.Pattern.compile("^(?:NotFound|InvalidParameter)\\.asset",
                    java.util.regex.Pattern.CASE_INSENSITIVE);

    /**
     * 查单条素材的上游状态。
     *
     * @param token      该用户的 sk-（从 user_info 取回）
     * @param materialId 素材库素材 id（asset-...）
     * @return 解析出的状态；查不到的情形**一律返回 null**（网络失败 / 非 2xx / 信封不合预期）——
     *         调用方按「本轮未知，保持 Processing」处理，不误判为可用也不误判为失败。
     *         唯一例外是上游明确指认素材不可用（见 {@link #MATERIAL_LEVEL_REJECTION_CODE}），
     *         那种情况按 `Failed` 返回，让状态收敛到终态。
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
        int httpStatus;
        try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
            ResponseBody body = response.body();
            rawText = body != null ? body.string() : "";
            httpStatus = response.code();
        } catch (Exception e) {
            // 网络/超时：本轮未知。下一轮（5s 后）再试，窗口内共 10 分钟。
            log.warn("GetAsset 请求失败 materialId={}: {}", materialId, e.getMessage());
            return null;
        }

        if (httpStatus < 200 || httpStatus >= 300) {
            MaterialStatusResult rejected = asMaterialRejection(rawText, materialId);
            if (rejected != null) return rejected;
            log.warn("GetAsset 非 2xx materialId={} HTTP {}", materialId, httpStatus);
            return null;
        }

        return parseResult(rawText, materialId);
    }

    /**
     * 非 2xx 时判断上游是不是在指认「这个素材不可用」。
     * 是 → 合成一条 `Failed` 让调用方收敛到终态；否 → null（本轮未知）。
     */
    private MaterialStatusResult asMaterialRejection(String rawText, String materialId) {
        JsonNode parsed;
        try {
            parsed = JSON.readTree(rawText);
        } catch (Exception e) {
            return null; // 非 JSON（可能是网关自己的错误页）→ 本轮未知
        }
        JsonNode error = parsed.get("ResponseError");
        if (error == null || !error.isObject()) return null;
        JsonNode codeNode = error.get("Code");
        if (codeNode == null || !codeNode.isTextual()) return null;
        String code = codeNode.asText();
        if (!MATERIAL_LEVEL_REJECTION_CODE.matcher(code).find()) return null;

        JsonNode messageNode = error.get("Message");
        log.info("GetAsset 上游指认素材不可用 materialId={} code={}", materialId, code);
        return new MaterialStatusResult("Failed", code,
                messageNode != null && messageNode.isTextual() ? messageNode.asText() : null);
    }

    /**
     * 删除上游素材（IKFYHJ：上游判定失败时的清理动作）。
     * <p>
     * 与 {@link #getAsset} 同样的「缺配置不抛」口径——本类不是 tag 消费；缺 baseUrl 时按
     * 返回值处理，不外抛。区别是这里把失败**当返回值**（false）而不是 null：调用方要决定是否记日志，
     * 但都不能因此中断跟进循环。
     *
     * @return true = 上游确认删除成功（2xx）
     */
    public boolean deleteAsset(String token, String materialId) {
        if (baseUrl == null) {
            if (!missingBaseUrlLogged) {
                missingBaseUrlLogged = true;
                log.warn("素材清理跳过：NEW_API_BASE_URL 未配置");
            }
            return false;
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token 不能为空");
        }
        if (materialId == null || materialId.isBlank()) {
            throw new IllegalArgumentException("materialId 不能为空");
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("Id", materialId);

        String bodyJson;
        try {
            bodyJson = JSON.writeValueAsString(payload);
        } catch (Exception e) {
            log.error("DeleteAsset 请求序列化失败 materialId={}: {}", materialId, e.getMessage());
            return false;
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(baseUrl + "/api/material/DeleteAsset")
                .post(RequestBody.create(bodyJson, JSON_TYPE))
                .header("Content-Type", "application/json");
        NewApiHttpSupport.applyStandardHeaders(requestBuilder, token, UUID.randomUUID().toString());

        try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
            if (response.isSuccessful()) {
                log.info("已清理上游失败素材 materialId={}", materialId);
                return true;
            }
            log.warn("清理上游失败素材未成功 materialId={} HTTP {}", materialId, response.code());
            return false;
        } catch (Exception e) {
            log.warn("清理上游失败素材异常 materialId={}: {}", materialId, e.getMessage());
            return false;
        }
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
