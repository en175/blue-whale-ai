package com.blue.whale.agent.service.generation;

public record PreparedGenerationObject(
        String storageKey,
        String contentSha256,
        String mimeType,
        long sizeBytes) {
}
