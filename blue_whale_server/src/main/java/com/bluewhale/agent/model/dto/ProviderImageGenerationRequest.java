package com.bluewhale.agent.model.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 图片生成 Provider 请求：经过能力表映射后传给具体厂商 SDK 的参数。
 *
 * <p>字段已经由业务层按模型能力过滤/转换（如 size 是上游 API 需要的 {@code api_value}），
 * Provider 实现直接消费即可。
 */
@Getter
@Builder
public class ProviderImageGenerationRequest {

    private final String modelId;
    private final String prompt;

    /** 上游 API 需要的 size 值，如 {@code 2K}、{@code 1024x1024} */
    private final String size;

    /** 宽高比，透传给需要使用的 Provider */
    private final String aspectRatio;

    /** 输出格式，如 {@code png}/{@code jpeg}；null 表示使用上游默认值 */
    private final String outputFormat;

    /** 生成数量 */
    private final Integer quantity;

    /** 参考图 URL 列表 */
    private final List<String> referenceImages;

    /** 是否加水印 */
    private final Boolean watermark;

    /** 是否开启组图（顺序图片生成） */
    private final Boolean sequentialImageGeneration;

    /** 是否开启流式 */
    private final Boolean stream;

    /** 是否开启工具（如联网搜索） */
    private final Boolean tools;
}
