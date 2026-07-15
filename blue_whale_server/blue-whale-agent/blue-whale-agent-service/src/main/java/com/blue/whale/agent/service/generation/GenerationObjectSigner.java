package com.blue.whale.agent.service.generation;

public interface GenerationObjectSigner {

    SignedGenerationObject sign(String storageKey);
}
