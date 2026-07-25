package com.blue.whale.agent.service.generation;

public enum ProviderCancellationCapability {
    NONE,
    QUEUED_ONLY,
    NON_TERMINAL;

    public boolean supports(ProviderObservation.Status status) {
        return switch (this) {
            case NONE -> false;
            case QUEUED_ONLY -> status == ProviderObservation.Status.QUEUED;
            case NON_TERMINAL -> status == ProviderObservation.Status.QUEUED
                    || status == ProviderObservation.Status.RUNNING;
        };
    }
}
