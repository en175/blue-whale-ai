package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.AudioTrimContract;

public class AudioTrimError extends RuntimeException {

    public static final String AUDIO_TRIM_FAILED = "audio_trim_failed";

    private final String code;

    public AudioTrimError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
