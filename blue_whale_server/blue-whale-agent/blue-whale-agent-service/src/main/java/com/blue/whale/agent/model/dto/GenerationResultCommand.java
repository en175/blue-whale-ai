package com.blue.whale.agent.model.dto;

public record GenerationResultCommand(
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
        Integer width,
        Integer height) {

    public GenerationResultCommand(
            Long jobId,
            int slotIndex,
            int expectedJobVersion,
            long fencingToken,
            String leaseOwner,
            String deliveryId,
            String storageKey,
            String contentSha256,
            String mimeType,
            long sizeBytes) {
        this(jobId, slotIndex, expectedJobVersion, fencingToken, leaseOwner, deliveryId,
                storageKey, contentSha256, mimeType, sizeBytes, null, null);
    }
}
