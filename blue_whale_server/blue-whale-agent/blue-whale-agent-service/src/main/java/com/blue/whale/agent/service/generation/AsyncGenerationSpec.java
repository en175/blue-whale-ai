package com.blue.whale.agent.service.generation;

public record AsyncGenerationSpec(
        Long projectId,
        Long userId,
        String prompt,
        Long referenceAssetId,
        String aspectRatio,
        String resolution,
        int durationSeconds,
        String callbackUrl) {
}
