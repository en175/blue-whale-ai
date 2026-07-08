package com.bluewhale.agent.model.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 文生图请求（Dock 直填式）。
 *
 * @param prompt          生成提示词（必填）
 * @param resolution      分辨率，如 {@code 1024x1024}，映射为 Ark size
 * @param aspectRatio     宽高比，如 {@code 16:9}
 * @param quantity        生成数量（MVP 固定取首张）
 * @param referenceImages 参考图 url 列表（可选）
 */
public record ImageGenerateRequest(
        @NotBlank(message = "prompt 必填") String prompt,
        String resolution,
        String aspectRatio,
        Integer quantity,
        List<String> referenceImages
) {
}
