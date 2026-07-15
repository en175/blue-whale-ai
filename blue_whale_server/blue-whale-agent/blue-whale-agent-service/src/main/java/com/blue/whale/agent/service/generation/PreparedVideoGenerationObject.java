package com.blue.whale.agent.service.generation;

public record PreparedVideoGenerationObject(
        String storageKey,
        String mimeType,
        long sizeBytes) {
}
