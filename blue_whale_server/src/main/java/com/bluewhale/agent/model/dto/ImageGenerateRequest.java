package com.bluewhale.agent.model.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 文生图请求（Dock 直填式）。
 *
 * @param prompt          生成提示词（必填）
 * @param modelId         模型 ID（必填），如 {@code doubao-seedream-5-0-lite-250723}
 * @param sizeId          尺寸选项 ID（必填），如 {@code 2k}/{@code 1024x1024}
 * @param aspectRatio     宽高比，如 {@code 16:9}
 * @param format          输出格式，如 {@code png}/{@code jpeg}；仅部分模型支持
 * @param quantity        生成数量
 * @param watermark       是否添加水印
 * @param referenceImages 参考图 url 列表（可选）
 */
public record ImageGenerateRequest(
        @NotBlank(message = "prompt 必填") String prompt,
        @NotBlank(message = "model_id 必填") String modelId,
        @NotBlank(message = "size_id 必填") String sizeId,
        String aspectRatio,
        String format,
        Integer quantity,
        Boolean watermark,
        List<String> referenceImages
) {
}
