package com.bluewhale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

/**
 * 前端模型能力发现接口响应项。
 */
@Getter
@AllArgsConstructor
public class ImageModelCapabilityResponse {

    private final String modelId;
    private final String providerId;
    private final String modelLabel;
    private final String icon;
    private final List<SizeOption> supportedSizes;
    private final List<String> supportedAspectRatios;
    private final List<String> supportedFormats;
    private final String defaultSize;
    private final String defaultFormat;
    private final String defaultAspectRatio;
    private final Features features;

    @Getter
    @AllArgsConstructor
    public static class SizeOption {
        private final String id;
        private final String label;
        private final String apiValue;
        private final Integer width;
        private final Integer height;
    }

    @Getter
    @AllArgsConstructor
    public static class Features {
        private final Boolean referenceImage;
        private final Boolean watermark;
        private final Integer quantityMax;
        private final Boolean sequentialImageGeneration;
        private final Boolean stream;
        private final Boolean tools;
    }
}
