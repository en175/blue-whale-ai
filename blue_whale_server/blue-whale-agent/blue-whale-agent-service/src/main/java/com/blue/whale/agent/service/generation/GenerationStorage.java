package com.blue.whale.agent.service.generation;

public interface GenerationStorage {

    StoredGenerationObject store(byte[] content, String mimeType);
}
