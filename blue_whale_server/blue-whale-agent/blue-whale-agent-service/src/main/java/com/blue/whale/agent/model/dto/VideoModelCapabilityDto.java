package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

/**
 * 视频生成模型能力发现接口响应项。
 *
 * <p>与 {@link ImageModelCapabilityDto} 分开，承载 video 语义（分辨率/时长区间/视频特性开关）。
 * HTTP JSON 字段 camelCase（ADR-0019）。
 */
@Getter
@AllArgsConstructor
public class VideoModelCapabilityDto {

    private final String modelId;
    private final String providerId;
    private final String modelLabel;
    private final String icon;
    private final List<ResolutionOption> supportedResolutions;
    private final List<String> supportedAspectRatios;
    private final DurationRange durationRange;
    private final String defaultResolution;
    private final String defaultAspectRatio;
    private final Integer defaultDuration;
    private final VideoFeatures features;

    @Getter
    @AllArgsConstructor
    public static class ResolutionOption {
        private final String id;
        private final String label;
        private final String apiValue;
    }

    @Getter
    @AllArgsConstructor
    public static class DurationRange {
        private final Integer min;
        private final Integer max;
        private final Integer step;
    }

    @Getter
    @AllArgsConstructor
    public static class VideoFeatures {
        /** 图生视频-首帧 */
        private final Boolean firstFrame;
        /** 图生视频-首尾帧 */
        private final Boolean firstLastFrame;
        /** 多模态参考图生视频 */
        private final Boolean referenceImage;
        private final Boolean watermark;
        /** 是否支持生成同步音频（Seedance 2.0 系列） */
        private final Boolean audio;
        private final Boolean tools;
    }
}
