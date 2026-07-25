package com.blue.whale.agent.service.generation;

public interface VideoResultIngestor {

    VideoIngestedResult ingest(
            Long jobId,
            int slotIndex,
            String temporaryResultUrl,
            Integer providerDurationSeconds,
            int expectedDurationSeconds);
}
