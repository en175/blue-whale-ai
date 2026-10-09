package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.common.http.NewApiHttpSupport;

import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamBaseUrl;
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

@Component
public class NewApiMaterialClient {

    private static final Logger log = LoggerFactory.getLogger(NewApiMaterialClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private static final long CONNECT_TIMEOUT_MS = 10_000L;
    private static final long READ_TIMEOUT_MS = 15_000L;

    private final String baseUrl;
    private final OkHttpClient httpClient;

    public NewApiMaterialClient(UpstreamBaseUrl baseUrl) {
        this.baseUrl = baseUrl.normalized();
        this.httpClient = NewApiHttpSupport.buildClient(
                CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS, READ_TIMEOUT_MS);
    }

    private static final java.util.regex.Pattern MATERIAL_LEVEL_REJECTION_CODE =
            java.util.regex.Pattern.compile("^(?:NotFound|InvalidParameter)\\.asset",
                    java.util.regex.Pattern.CASE_INSENSITIVE);

    public MaterialStatusResult getAsset(String token, String materialId) {
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

    private MaterialStatusResult asMaterialRejection(String rawText, String materialId) {
        JsonNode parsed;
        try {
            parsed = JSON.readTree(rawText);
        } catch (Exception e) {
            return null;
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

    public boolean deleteAsset(String token, String materialId) {
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

    public record MaterialStatusResult(String status, String errorCode, String errorMessage) {}
}
