package com.blue.whale.agent.service.generation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;

import java.util.UUID;

/**
 * 生成任务认领调度器（注册见 {@code GenerationAdapterConfiguration#generationWorkerScheduler}）。
 *
 * <p>经 {@link ObjectProvider} 惰性解析 GenerationWorker，不用 {@code @ConditionalOnBean}：
 * 该条件无论在扫描组件还是同类配置类上都依赖 bean 注册顺序，曾把调度器静默跳过，
 * 导致 GenerationJob 永远停在 queued（IK1NS2 实测复现）。mode=disabled 无 worker 时
 * 调度周期空转，启动不受影响；装配了 worker 即开始认领。
 */
@Slf4j
@RequiredArgsConstructor
public class GenerationWorkerScheduler {

    private static final int MAX_BATCH_SIZE = 8;

    private final ObjectProvider<GenerationWorker> workerProvider;
    private final String workerId = "generation-worker-" + UUID.randomUUID();

    @Scheduled(fixedDelayString = "${blue-whale.generation.worker-delay-ms:1000}")
    public void processDue() {
        GenerationWorker worker = workerProvider.getIfAvailable();
        if (worker == null) {
            return;
        }
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
