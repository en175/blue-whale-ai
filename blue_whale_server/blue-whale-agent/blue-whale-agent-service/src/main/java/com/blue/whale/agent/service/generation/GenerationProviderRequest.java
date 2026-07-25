package com.blue.whale.agent.service.generation;

import java.util.Map;

public record GenerationProviderRequest(
        Long projectId,
        Long userId,
        Map<String, Object> input) {
}
