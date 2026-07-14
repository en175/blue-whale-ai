package com.blue.whale.agent.service.generation;

import java.util.Map;

public interface GenerationProvider {

    GenerationProviderResult generate(Map<String, Object> input);
}
