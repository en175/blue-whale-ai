package com.blue.whale.agent.service.generation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnBean(GenerationWorker.class)
@ConditionalOnProperty(
        name = "blue-whale.generation.worker-scheduled",
        havingValue = "true",
        matchIfMissing = true)
public class GenerationWorkerScheduler {

    private static final int MAX_BATCH_SIZE = 8;

    private final GenerationWorker worker;
    private final String workerId = "generation-worker-" + UUID.randomUUID();

    @Scheduled(fixedDelayString = "${blue-whale.generation.worker-delay-ms:1000}")
    public void processDue() {
        try {
            for (int processed = 0; processed < MAX_BATCH_SIZE; processed++) {
                if (!worker.runOnce(workerId)) {
                    return;
                }
            }
        } catch (RuntimeException exception) {
            log.warn("generation worker cycle failed", exception);
        }
    }
}
