package com.blue.whale.agent.service.generation;

public class ProviderSubmissionException extends RuntimeException {

    private final boolean ambiguous;
    private final String rawCode;

    public ProviderSubmissionException(boolean ambiguous, String rawCode, String message, Throwable cause) {
        super(message, cause);
        this.ambiguous = ambiguous;
        this.rawCode = rawCode;
    }

    public boolean isAmbiguous() {
        return ambiguous;
    }

    public String getRawCode() {
        return rawCode;
    }
}
