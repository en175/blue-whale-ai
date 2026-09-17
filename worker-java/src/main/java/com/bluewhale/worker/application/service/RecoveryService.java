package com.bluewhale.worker.application.service;

import com.bluewhale.worker.config.WorkerProperties;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * recovery 兜底扫描（IKF3AT；TS recovery.service.ts:38-106 逐字移植）。
 * <p>
 * 背景：TS worker 退役后，没有它就没有任何进程会把「到点但没消息」的 job 重新投进 MQ——
 * 瞬态重试回队的 job、worker 崩溃留下的 processing 孤儿，都会永久卡住（本地实测形态）。
 * 本服务按 tag 每 {@code GENERATION_RECOVERY_INTERVAL_MS}（默认 60s）扫一次库并重投同 body 消息。
 * <p>
 * 扫描条件（mapper 内 SQL 逐字移植 claim-ops.ts:134-230）：
 * {@code is_delete=false} + 创建在 {@code RECOVERY_MAX_AGE_MINUTES}（默认 120 分钟）内
 * + {@code next_action_at<=now} + （queued ∨ processing 且租约空/过期）。
 * <p>
 * 开关语义（灰度）：只对 {@code WORKER_ENABLED_TAGS} 内的 tag 重投——生产者 bean 本身带
 * {@code @Conditional}，未启用 tag 时 {@code getIfAvailable()=null} 即跳过；TS 侧同时运行 recovery
 * 时重复投递无害（契约 §7：claim-by-id CAS + null-claim ack 幂等）。
 * <p>
 * 与 TS 的两处刻意差异：① 窗口 24h→2h（用户 2026-09-11 指示，避免复活陈旧 job）；
 * ② 不移植 {@code resetStalledImageJobs}——TS 侧该函数无活调用方（死代码），
 * 孤儿由 claim-by-id「processing + 租约过期可接管」语义直接接走。
 */
@Service
public class RecoveryService {

    private static final Logger log = LoggerFactory.getLogger(RecoveryService.class);

    /** 每轮每类批大小（契约 §7：批 100）。 */
    private static final int SCAN_LIMIT = 100;

    /** 重投延迟下限（video-queue.ts:17 VIDEO_MIN_DELAY_MS，producer 侧同样钳制）。 */
    private static final long REENQUEUE_DELAY_MS = 1000L;

    private final GenerationJobMapper jobMapper;
    private final ObjectProvider<GenerationMessageProducer> videoProducer;
    private final ObjectProvider<GenerationMessageProducer> imageProducer;
    private final ObjectProvider<GenerationMessageProducer> audioProducer;
    private final ObjectProvider<GenerationMessageProducer> mediaExtractProducer;
    private final ObjectProvider<GenerationMessageProducer> imageEnhanceProducer;
    private final WorkerProperties workerProps;
    private final int maxAgeMinutes;
    /** 空 tags 提示只打一次（避免安全拉起形态下每 60s 刷屏）。 */
    private boolean emptyTagsLogged;

    public RecoveryService(
            GenerationJobMapper jobMapper,
            @Qualifier("generationMessageProducer")
            ObjectProvider<GenerationMessageProducer> videoProducer,
            @Qualifier("imageRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageProducer,
            @Qualifier("audioRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> audioProducer,
            @Qualifier("mediaExtractRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> mediaExtractProducer,
            @Qualifier("imageEnhanceRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageEnhanceProducer,
            WorkerProperties workerProps,
            @Value("${RECOVERY_MAX_AGE_MINUTES:120}") int maxAgeMinutes
    ) {
        this.jobMapper = jobMapper;
        this.videoProducer = videoProducer;
        this.imageProducer = imageProducer;
        this.audioProducer = audioProducer;
        this.mediaExtractProducer = mediaExtractProducer;
        this.imageEnhanceProducer = imageEnhanceProducer;
        this.workerProps = workerProps;
        this.maxAgeMinutes = maxAgeMinutes;
    }

    /**
     * 到点/孤儿补入队（TS recovery.service.ts:38-106 recover()）。
     * <p>
     * 启动后立即扫一次（initialDelay=0，对齐 TS onModuleInit），此后固定间隔。
     * 单轮内任一 job 投递失败只记 error，不中断本轮后续 tag（TS 逐条 catch 同款）；
     * 整轮异常兜底 catch，避免调度线程被异常终止。
     */
    @Scheduled(
            initialDelayString = "${GENERATION_RECOVERY_INITIAL_DELAY_MS:0}",
            fixedDelayString = "${GENERATION_RECOVERY_INTERVAL_MS:60000}"
    )
    public void recover() {
        // 安全拉起形态（WORKER_ENABLED_TAGS 为空）：DataSource 是 stub（不连库），
        // 此时扫库必抛异常 → 每 60s 错误刷屏。直接短路，保持「空 tags = 只起 /ready」的部署语义。
        if (workerProps.enabledTags().isEmpty()) {
            if (!emptyTagsLogged) {
                emptyTagsLogged = true;
                log.info("recovery 跳过：WORKER_ENABLED_TAGS 为空（安全拉起形态，不连库不扫库）");
            }
            return;
        }
        try {
            reenqueue("video", videoProducer.getIfAvailable(),
                    jobMapper.listDueVideoJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue("image", imageProducer.getIfAvailable(),
                    jobMapper.listDueImageJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue("media_extract", mediaExtractProducer.getIfAvailable(),
                    jobMapper.listDueMediaExtractJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue("audio", audioProducer.getIfAvailable(),
                    jobMapper.listDueAudioJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue("image_enhance", imageEnhanceProducer.getIfAvailable(),
                    jobMapper.listDueImageEnhanceJobIds(SCAN_LIMIT, maxAgeMinutes));
        } catch (Exception e) {
            log.error("recovery scan failed: {}", e.getMessage(), e);
        }
    }

    /** 单 tag 重投：生产者缺失（tag 未启用）即跳过——灰度开关在此闭环。 */
    private void reenqueue(String tag, GenerationMessageProducer producer, List<Long> jobIds) {
        if (producer == null) {
            return;
        }
        for (Long jobId : jobIds) {
            try {
                log.info("recovery re-enqueue stuck {} job {}", tag, jobId);
                producer.enqueue(String.valueOf(jobId), REENQUEUE_DELAY_MS);
            } catch (Exception e) {
                // 与 TS 同款：单条失败只记错，本轮后续继续、下轮扫描再试。
                log.error("recovery enqueue {} job {} failed: {}", tag, jobId, e.getMessage(), e);
            }
        }
    }
}
