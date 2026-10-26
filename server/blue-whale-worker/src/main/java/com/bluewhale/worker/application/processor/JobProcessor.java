package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;

import java.util.Optional;

public interface JobProcessor {

    String tag();

    void handle(String jobId);

    default Optional<ClaimSpec> claimSpec() {
        return Optional.empty();
    }
}
