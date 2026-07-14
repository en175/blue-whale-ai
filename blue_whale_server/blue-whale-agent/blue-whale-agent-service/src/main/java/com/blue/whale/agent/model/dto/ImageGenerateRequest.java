package com.blue.whale.agent.model.dto;


import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.constraints.NotBlank;
import java.util.List;

/**
 * 文生图请求（Dock 直填式）。
 *
 * <p>字段显式 {@code @JsonProperty} 指定 snake_case 名：record + 全局
 * {@code SNAKE_CASE} 命名策略下，Jackson 对 creator 参数的自省会与 final 字段的
 * FieldProperty 冲突，抛 {@code IllegalAccessException}（record 字段不可反射写入）。
 *
 * @param prompt          生成提示词（必填）
 * @param modelId         模型 ID（必填），如 {@code doubao-seedream-5-0-lite-250723}
 * @param sizeId          尺寸选项 ID（必填），如 {@code 2k}/{@code 1024x1024}
 * @param aspectRatio     宽高比，如 {@code 16:9}
 * @param format          输出格式，如 {@code png}/{@code jpeg}；仅部分模型支持
 * @param quantity        生成数量
 * @param watermark       是否添加水印
 * @param referenceImages 参考图 url 列表（可选）
 * @param projectId       所属 Project（画布内生成时传入；独立生成页可空）
 */
public record ImageGenerateRequest(
        @NotBlank(message = "prompt 必填") String prompt,
        @JsonProperty("model_id") @NotBlank(message = "model_id 必填") String modelId,
        @JsonProperty("size_id") @NotBlank(message = "size_id 必填") String sizeId,
        @JsonProperty("aspect_ratio") String aspectRatio,
        String format,
        Integer quantity,
        Boolean watermark,
        @JsonProperty("reference_images") List<String> referenceImages,
        @JsonProperty("project_id") Long projectId
) {
}
