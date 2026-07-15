package com.blue.whale.agent.service.generation;

public interface VideoResultIngestor {

    VideoIngestedResult ingest(
            Long jobId,
            String temporaryResultUrl,
            Integer providerDurationSeconds,
            int expectedDurationSeconds);
}
