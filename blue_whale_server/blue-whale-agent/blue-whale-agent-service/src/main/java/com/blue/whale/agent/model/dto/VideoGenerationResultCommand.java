package com.blue.whale.agent.model.dto;

public record VideoGenerationResultCommand(
        Long jobId,
        int slotIndex,
        int expectedJobVersion,
        long fencingToken,
        String leaseOwner,
        String deliveryId,
        String storageKey,
        String contentSha256,
        String mimeType,
        long sizeBytes,
        int durationSeconds) {
}
