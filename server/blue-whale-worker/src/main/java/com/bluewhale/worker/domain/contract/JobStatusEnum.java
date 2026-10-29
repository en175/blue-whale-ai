package com.bluewhale.worker.domain.contract;

public enum JobStatusEnum {

    QUEUED("queued"),

    PROCESSING("processing"),

    CHECKING("checking"),

    SUCCEEDED("succeeded"),

    PARTIALLY_SUCCEEDED("partially_succeeded"),

    FAILED("failed"),

    CANCELLED("cancelled");

    private final String value;

    JobStatusEnum(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
