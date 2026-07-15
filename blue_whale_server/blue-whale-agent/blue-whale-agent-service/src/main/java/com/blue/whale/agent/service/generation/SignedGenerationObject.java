package com.blue.whale.agent.service.generation;

import java.time.Instant;

public record SignedGenerationObject(String url, Instant expiresAt) {
}
