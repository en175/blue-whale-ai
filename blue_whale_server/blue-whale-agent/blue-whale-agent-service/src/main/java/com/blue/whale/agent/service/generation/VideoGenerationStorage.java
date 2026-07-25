package com.blue.whale.agent.service.generation;

import java.io.InputStream;

public interface VideoGenerationStorage {

    PreparedVideoGenerationObject prepareVideo(
            Long jobId,
            int slotIndex,
            long contentLength,
            String mimeType);

    StoredGenerationObject storeVideo(
            PreparedVideoGenerationObject prepared,
            InputStream content);

    default StoredGenerationObject storeVideo(
            Long jobId,
            int slotIndex,
            InputStream content,
            long contentLength,
            String mimeType) {
        return storeVideo(prepareVideo(jobId, slotIndex, contentLength, mimeType), content);
    }
}
