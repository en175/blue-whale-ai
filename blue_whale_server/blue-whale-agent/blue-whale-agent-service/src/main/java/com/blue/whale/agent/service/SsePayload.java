package com.blue.whale.agent.service;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * SSE 推送给前端的事件载荷；{@code type} 同时作为 SSE event name。
 *
 * <p>字段对齐 spec：{@code image}/{@code image_failed}/{@code done}/{@code error}。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SsePayload(String type, Integer imageIndex, Long assetId, String url,
                         String errorCode, String errorMessage, Map<String, Object> error,
                         Object usage) {

    public SsePayload {
        if (error != null) {
            error = Collections.unmodifiableMap(new LinkedHashMap<>(error));
        }
    }

    /** 逐张成功。 */
    public static SsePayload image(int imageIndex, Long assetId, String url) {
        return new SsePayload("image", imageIndex, assetId, url, null, null, null, null);
    }

    /** 单张失败（非内部错误，不终止）。 */
    public static SsePayload imageFailed(int imageIndex, String budgetEffect) {
        String code = "image_generation_failed";
        String message = "图像生成失败";
        return new SsePayload("image_failed", imageIndex, null, null, code, message,
                GenerationPublicError.requestNeutralEnvelope(code, message, budgetEffect), null);
    }

    /** 全部完成。 */
    public static SsePayload done(Object usage) {
        return new SsePayload("done", null, null, null, null, null, null, usage);
    }

    /** 流终止错误。 */
    public static SsePayload error(String budgetEffect) {
        String code = "image_generation_failed";
        String message = "图像生成失败";
        return new SsePayload("error", null, null, null, code, message,
                GenerationPublicError.requestNeutralEnvelope(code, message, budgetEffect), null);
    }

    SsePayload withRequestId(String requestId) {
        if (error == null) {
            return this;
        }
        Map<String, Object> deliveryError = new LinkedHashMap<>(error);
        deliveryError.put("request_id", requestId);
        return new SsePayload(type, imageIndex, assetId, url, errorCode, errorMessage,
                deliveryError, usage);
    }
}
