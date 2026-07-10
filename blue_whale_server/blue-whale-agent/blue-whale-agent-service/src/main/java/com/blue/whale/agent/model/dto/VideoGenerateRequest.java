package com.blue.whale.agent.model.dto;


import javax.validation.constraints.NotBlank;

/**
 * 图文生视频请求（Dock 直填式，异步提交）。
 *
 * @param prompt        生成提示词（必填）
 * @param modelId       模型 ID（必填），如 {@code doubao-seedance-2-0-260128}
 * @param resolution    分辨率
 * @param aspectRatio   宽高比，如 {@code 16:9}（Ark ratio）
 * @param duration      时长（秒）
 * @param firstFrameUrl 首帧图 url（可选）
 */
public record VideoGenerateRequest(
        @NotBlank(message = "prompt 必填") String prompt,
        @NotBlank(message = "model_id 必填") String modelId,
        String resolution,
        String aspectRatio,
        Long duration,
        String firstFrameUrl
) {
}
