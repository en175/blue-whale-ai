package com.blue.whale.agent.model.request;


import javax.validation.constraints.NotBlank;
import java.util.List;

/**
 * 图文生视频请求（Dock 直填式，异步提交）。
 *
 * <p>HTTP JSON 字段 camelCase，按 Java 字段名原样收发（ADR-0019）。
 *
 * <p>火山 Seedance 三场景互斥：首帧（{@code firstFrameUrl}）/ 首尾帧（{@code + lastFrameUrl}）
 * / 全能参考（{@code referenceImages}+{@code referenceVideos}+{@code referenceAudios}），
 * 不可同时提交。当前 URL 直传，assetId 引用留作后续统一改造（spec D7）。
 *
 * @param prompt          生成提示词（必填）
 * @param modelId         模型 ID（必填），如 {@code doubao-seedance-2-0-260128}
 * @param resolution      分辨率
 * @param aspectRatio     宽高比，如 {@code 16:9}（Ark ratio）
 * @param duration        时长（秒）
 * @param firstFrameUrl   首帧图 url（可选，首尾帧模式）
 * @param lastFrameUrl    尾帧图 url（可选，首尾帧模式）
 * @param referenceImages 全能参考图 url 列表（可选，≤9）
 * @param referenceVideos 全能参考视频 url 列表（可选，≤3）
 * @param referenceAudios 全能参考音频 url 列表（可选，≤3；不可单独，需配图或视频）
 */
public record VideoGenerateRequest(
        Long projectId,
        @NotBlank(message = "prompt 必填") String prompt,
        @NotBlank(message = "modelId 必填") String modelId,
        String resolution,
        String aspectRatio,
        Long duration,
        String firstFrameUrl,
        String lastFrameUrl,
        List<String> referenceImages,
        List<String> referenceVideos,
        List<String> referenceAudios
) {
}
