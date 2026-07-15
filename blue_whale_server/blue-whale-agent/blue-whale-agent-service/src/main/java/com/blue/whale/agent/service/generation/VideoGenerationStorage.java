package com.blue.whale.agent.service.generation;

import java.io.InputStream;

public interface VideoGenerationStorage {

    StoredGenerationObject storeVideo(
            Long jobId,
            int slotIndex,
            InputStream content,
            long contentLength,
            String mimeType);
}
