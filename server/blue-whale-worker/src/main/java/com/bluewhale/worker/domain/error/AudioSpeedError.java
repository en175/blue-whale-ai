package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.AudioSpeedContract;

public class AudioSpeedError extends RuntimeException {

    public static final String AUDIO_SPEED_FAILED = "audio_speed_failed";

    private final String code;

    public AudioSpeedError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
