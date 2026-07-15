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
@ConditionalOnBean(AssetObjectGarbageCollector.class)
@ConditionalOnProperty(
        name = "blue-whale.generation.asset-gc-scheduled",
        havingValue = "true",
        matchIfMissing = true)
public class AssetObjectGarbageCollectionScheduler {

    private static final int MAX_BATCH_SIZE = 32;

    private final AssetObjectGarbageCollector collector;
    private final String workerId = "asset-gc-" + UUID.randomUUID();

    @Scheduled(fixedDelayString = "${blue-whale.generation.asset-gc-delay-ms:60000}")
    public void processDue() {
        try {
            for (int processed = 0; processed < MAX_BATCH_SIZE; processed++) {
                if (!collector.runOnce(workerId)) {
                    return;
                }
            }
        } catch (RuntimeException exception) {
            log.warn("asset object garbage collection cycle failed", exception);
        }
    }
}
