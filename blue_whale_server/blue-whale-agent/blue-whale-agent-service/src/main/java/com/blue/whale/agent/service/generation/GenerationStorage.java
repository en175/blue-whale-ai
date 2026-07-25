package com.blue.whale.agent.service.generation;

public interface GenerationStorage {

    PreparedGenerationObject prepare(byte[] content, String mimeType);

    StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content);

    default StoredGenerationObject store(byte[] content, String mimeType) {
        PreparedGenerationObject prepared = prepare(content, mimeType);
        return store(prepared, content);
    }
}
