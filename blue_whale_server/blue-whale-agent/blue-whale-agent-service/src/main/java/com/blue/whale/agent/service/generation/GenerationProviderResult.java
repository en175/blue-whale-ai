package com.blue.whale.agent.service.generation;

public record GenerationProviderResult(
        Status status,
        byte[] content,
        String mimeType,
        Integer width,
        Integer height,
        String errorCode,
        String errorMessage) {

    public enum Status {
        SUCCESS,
        FAILURE,
        NO_RESULT
    }

    public static GenerationProviderResult success(
            byte[] content,
            String mimeType,
            Integer width,
            Integer height) {
        return new GenerationProviderResult(Status.SUCCESS, content, mimeType, width, height, null, null);
    }

    public static GenerationProviderResult failure(String errorCode, String errorMessage) {
        return new GenerationProviderResult(Status.FAILURE, null, null, null, null, errorCode, errorMessage);
    }

    public static GenerationProviderResult noResult() {
        return new GenerationProviderResult(
                Status.NO_RESULT, null, null, null, null, "no_result", "生成未返回结果");
    }
}
