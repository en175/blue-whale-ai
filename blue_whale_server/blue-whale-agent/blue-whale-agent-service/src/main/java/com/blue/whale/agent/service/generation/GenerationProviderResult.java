package com.blue.whale.agent.service.generation;

import java.util.List;

/**
 * Provider 生成结果：组图模式下 {@link #images()} 承载单次方舟调用返回的 N 张关联图，
 * 单图调用返回 1 张。{@link #content()} / {@link #mimeType()} / {@link #width()} / {@link #height()}
 * 为单图消费方保留的便捷访问器（取首张），使单图路径字节级不变。
 */
public record GenerationProviderResult(
        Status status,
        List<ImageResult> images,
        String errorCode,
        String errorMessage) {

    public enum Status {
        SUCCESS,
        FAILURE,
        NO_RESULT
    }

    public record ImageResult(byte[] content, String mimeType, Integer width, Integer height) {
    }

    private ImageResult firstImage() {
        return images == null || images.isEmpty() ? null : images.get(0);
    }

    public byte[] content() {
        ImageResult first = firstImage();
        return first == null ? null : first.content();
    }

    public String mimeType() {
        ImageResult first = firstImage();
        return first == null ? null : first.mimeType();
    }

    public Integer width() {
        ImageResult first = firstImage();
        return first == null ? null : first.width();
    }

    public Integer height() {
        ImageResult first = firstImage();
        return first == null ? null : first.height();
    }

    public static GenerationProviderResult success(
            byte[] content,
            String mimeType,
            Integer width,
            Integer height) {
        return new GenerationProviderResult(
                Status.SUCCESS, List.of(new ImageResult(content, mimeType, width, height)), null, null);
    }

    public static GenerationProviderResult success(List<ImageResult> images) {
        return new GenerationProviderResult(Status.SUCCESS, images, null, null);
    }

    public static GenerationProviderResult failure(String errorCode, String errorMessage) {
        return new GenerationProviderResult(Status.FAILURE, List.of(), errorCode, errorMessage);
    }

    public static GenerationProviderResult noResult() {
        return new GenerationProviderResult(
                Status.NO_RESULT, List.of(), "no_result", "生成未返回结果");
    }
}
