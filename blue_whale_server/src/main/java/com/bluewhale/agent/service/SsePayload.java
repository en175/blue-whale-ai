package com.bluewhale.agent.service;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * SSE 推送给前端的事件载荷；{@code type} 同时作为 SSE event name。
 *
 * <p>字段对齐 spec：{@code image}/{@code image_failed}/{@code done}/{@code error}。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SsePayload(String type, Integer imageIndex, Long assetId, String url,
                         String errorCode, String errorMessage, Object usage) {

    /** 逐张成功。 */
    public static SsePayload image(int imageIndex, Long assetId, String url) {
        return new SsePayload("image", imageIndex, assetId, url, null, null, null);
    }

    /** 单张失败（非内部错误，不终止）。 */
    public static SsePayload imageFailed(int imageIndex, String errorCode, String errorMessage) {
        return new SsePayload("image_failed", imageIndex, null, null, errorCode, errorMessage, null);
    }

    /** 全部完成。 */
    public static SsePayload done(Object usage) {
        return new SsePayload("done", null, null, null, null, null, usage);
    }

    /** 流终止错误。 */
    public static SsePayload error(String errorCode, String errorMessage) {
        return new SsePayload("error", null, null, null, errorCode, errorMessage, null);
    }
}
