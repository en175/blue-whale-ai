package com.blue.whale.agent.model.dto;

public record GenerationAcceptanceResult(Status status, Long assetId) {

    public enum Status {
        ACCEPTED,
        IDEMPOTENT,
        CONFLICT,
        FAILED,
        CANCELLED
    }
}
