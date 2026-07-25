package com.blue.whale.agent.service.generation;

public record StoredGenerationObject(
        String storageKey,
        String contentSha256,
        String mimeType,
        long sizeBytes) {
}
