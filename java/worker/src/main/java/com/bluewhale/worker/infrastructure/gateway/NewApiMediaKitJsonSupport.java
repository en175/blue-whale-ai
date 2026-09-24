package com.bluewhale.worker.infrastructure.gateway;
import com.bluewhale.libs.http.NewApiHttpSupport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * MediaKit 客户端家族共享 JSON 工具（IKHKMK 收敛，延续刀③ NewApiHttpSupport 惯例）。
 * <p>
 * 覆盖十个 MediaKit 客户端（4 同步 + 6 异步）逐字重复的无类型 JSON 段：
 * 共享 {@link ObjectMapper}、data 解包、上游失败原因提取、文本截断、路径编码。
 * 不含任何抛族领域错误的逻辑——错误类型化骨架在
 * {@link NewApiMediaKitSyncClient} / {@link NewApiMediaKitAsyncTaskClient} 两个模板基类。
 * <p>
 * {@link #extractUpstreamMessage(String)} 取人声分离客户端的双层形态（data 解包层 +
 * 顶层两轮取非空合并）作为家族统一版：无网关 data 信封时两轮退化为同一轮，与既有
 * 单层版行为等价；有信封时比单层版多读到 data 层的错误原因（宽松化对齐，家族本该一致）。
 */
final class NewApiMediaKitJsonSupport {

    private static final Logger log = LoggerFactory.getLogger(NewApiMediaKitJsonSupport.class);

    /** 家族共享 mapper（Jackson 线程安全，无配置差异）。 */
    static final ObjectMapper JSON = new ObjectMapper();

    static final MediaType JSON_TYPE = MediaType.get("application/json");

    private NewApiMediaKitJsonSupport() {}

    /** data 解包（网关可能包 data 层；非对象形态回退顶层，家族同款）。 */
    static JsonNode unwrapData(JsonNode parsed) {
        return parsed.has("data") && parsed.get("data").isObject() ? parsed.get("data") : parsed;
    }

    /**
     * 提取上游可读失败原因（error.message 或顶层 message 字段，data 解包层与顶层
     * 两层都读取非空）。供应商原因透传给前端投影（失败 message 口径）。
     */
    static String extractUpstreamMessage(String rawText) {
        try {
            JsonNode parsed = JSON.readTree(rawText);
            for (JsonNode node : new JsonNode[] {unwrapData(parsed), parsed}) {
                JsonNode message = node.path("error").path("message");
                if (!message.isTextual() || message.asText().isEmpty()) {
                    message = node.path("message");
                }
                if (message.isTextual() && !message.asText().isEmpty()) {
                    return truncate(message.asText());
                }
            }
        } catch (Exception e) {
            log.debug("上游错误 body 非法 JSON，回退原文截断: {}", e.getMessage());
        }
        return "";
    }

    static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && v.isTextual()) ? v.asText() : null;
    }

    static String truncate(String text) {
        return text.length() > 300 ? text.substring(0, 300) + "…" : text;
    }

    static String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }
}
