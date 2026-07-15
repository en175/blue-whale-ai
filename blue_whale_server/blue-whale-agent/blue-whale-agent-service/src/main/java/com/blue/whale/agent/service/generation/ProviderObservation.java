package com.blue.whale.agent.service.generation;

public record ProviderObservation(
        Status status,
        String temporaryResultUrl,
        Integer durationSeconds,
        String errorCode,
        String errorMessage,
        String rawStatus,
        String rawErrorCode,
        String rawErrorMessage) {

    public enum Status {
        QUEUED,
        RUNNING,
        SUCCEEDED,
        FAILED,
        CANCELLED
    }
}
