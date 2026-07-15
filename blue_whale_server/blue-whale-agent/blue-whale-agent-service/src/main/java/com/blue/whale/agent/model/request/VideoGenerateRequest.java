package com.blue.whale.agent.model.request;


import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.constraints.NotBlank;

/**
 * 图文生视频请求（Dock 直填式，异步提交）。
 *
 * <p>字段显式 {@code @JsonProperty} 指定 snake_case 名，详见 {@link ImageGenerateRequest}。
 *
 * @param prompt        生成提示词（必填）
 * @param modelId       模型 ID（必填），如 {@code doubao-seedance-2-0-260128}
 * @param resolution    分辨率
 * @param aspectRatio   宽高比，如 {@code 16:9}（Ark ratio）
 * @param duration      时长（秒）
 * @param firstFrameUrl 首帧图 url（可选）
 */
public record VideoGenerateRequest(
        Long projectId,
        @NotBlank(message = "prompt 必填") String prompt,
        @JsonProperty("model_id") @NotBlank(message = "model_id 必填") String modelId,
        String resolution,
        @JsonProperty("aspect_ratio") String aspectRatio,
        Long duration,
        @JsonProperty("first_frame_url") String firstFrameUrl
) {
}
