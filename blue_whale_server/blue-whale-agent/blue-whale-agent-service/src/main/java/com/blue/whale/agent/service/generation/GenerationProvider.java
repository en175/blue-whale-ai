package com.blue.whale.agent.service.generation;

public interface GenerationProvider {

    GenerationProviderResult generate(GenerationProviderRequest request);
}
