package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
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
 * 重投覆盖全部 tag（每类一个 recovery producer bean 无条件装配，ADR-0084 修正六），
 * 因此正常情况下每类的 {@code getIfAvailable()} 都拿得到生产者；{@code reenqueue} 仍保留
 * 生产者缺失即跳过的判断，但那只作防御，不再对应任何开关语义。
 * TS 侧同时运行 recovery 时重复投递无害（契约 §7：claim-by-id CAS + null-claim ack 幂等）。
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

    /** 重投延迟下限（generation-queue.ts:17 GENERATION_MIN_DELAY_MS，producer 侧同样钳制）。 */
    private static final long REENQUEUE_DELAY_MS = 1000L;

    private final GenerationJobMapper jobMapper;
    private final ObjectProvider<GenerationMessageProducer> videoProducer;
    private final ObjectProvider<GenerationMessageProducer> imageProducer;
    private final ObjectProvider<GenerationMessageProducer> audioProducer;
    private final ObjectProvider<GenerationMessageProducer> mediaExtractProducer;
    private final ObjectProvider<GenerationMessageProducer> audioTrimProducer;
    private final ObjectProvider<GenerationMessageProducer> imageEnhanceProducer;
    private final ObjectProvider<GenerationMessageProducer> imageEraseProducer;
    private final ObjectProvider<GenerationMessageProducer> imageCutoutProducer;
    private final ObjectProvider<GenerationMessageProducer> imageOutpaintProducer;
    private final ObjectProvider<GenerationMessageProducer> videoSubtitleEraseProducer;
    private final ObjectProvider<GenerationMessageProducer> videoEnhanceProducer;
    private final ObjectProvider<GenerationMessageProducer> vocalSplitProducer;
    private final ObjectProvider<GenerationMessageProducer> videoSceneSplitProducer;
    private final ObjectProvider<GenerationMessageProducer> videoMattingProducer;
    private final ObjectProvider<GenerationMessageProducer> videoFrameInterpolationProducer;
    private final int maxAgeMinutes;

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
        @Qualifier("audioTrimRecoveryProducer")
        ObjectProvider<GenerationMessageProducer> audioTrimProducer,
            @Qualifier("imageEnhanceRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageEnhanceProducer,
            @Qualifier("imageEraseRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageEraseProducer,
            @Qualifier("imageCutoutRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageCutoutProducer,
            @Qualifier("imageOutpaintRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> imageOutpaintProducer,
            @Qualifier("videoSubtitleEraseRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> videoSubtitleEraseProducer,
            @Qualifier("videoEnhanceRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> videoEnhanceProducer,
            @Qualifier("vocalSplitRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> vocalSplitProducer,
            @Qualifier("videoSceneSplitRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> videoSceneSplitProducer,
            @Qualifier("videoMattingRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> videoMattingProducer,
            @Qualifier("videoFrameInterpolationRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> videoFrameInterpolationProducer,
            @Value("${RECOVERY_MAX_AGE_MINUTES:120}") int maxAgeMinutes
    ) {
        this.jobMapper = jobMapper;
        this.videoProducer = videoProducer;
        this.imageProducer = imageProducer;
        this.audioProducer = audioProducer;
        this.mediaExtractProducer = mediaExtractProducer;
        this.audioTrimProducer = audioTrimProducer;
        this.imageEnhanceProducer = imageEnhanceProducer;
        this.imageEraseProducer = imageEraseProducer;
        this.imageCutoutProducer = imageCutoutProducer;
        this.imageOutpaintProducer = imageOutpaintProducer;
        this.videoSubtitleEraseProducer = videoSubtitleEraseProducer;
        this.videoEnhanceProducer = videoEnhanceProducer;
        this.vocalSplitProducer = vocalSplitProducer;
        this.videoSceneSplitProducer = videoSceneSplitProducer;
        this.videoMattingProducer = videoMattingProducer;
        this.videoFrameInterpolationProducer = videoFrameInterpolationProducer;
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
        try {
            reenqueue(GenerationMqRouteEnum.VIDEO, videoProducer.getIfAvailable(),
                    jobMapper.listDueVideoJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.IMAGE, imageProducer.getIfAvailable(),
                    jobMapper.listDueImageJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.MEDIA_EXTRACT, mediaExtractProducer.getIfAvailable(),
                    jobMapper.listDueMediaExtractJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.AUDIO_TRIM, audioTrimProducer.getIfAvailable(),
                    jobMapper.listDueAudioTrimJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.AUDIO, audioProducer.getIfAvailable(),
                    jobMapper.listDueAudioJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.IMAGE_ENHANCE, imageEnhanceProducer.getIfAvailable(),
                    jobMapper.listDueImageEnhanceJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.IMAGE_ERASE, imageEraseProducer.getIfAvailable(),
                    jobMapper.listDueImageEraseJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.IMAGE_CUTOUT, imageCutoutProducer.getIfAvailable(),
                    jobMapper.listDueImageCutoutJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.IMAGE_OUTPAINT, imageOutpaintProducer.getIfAvailable(),
                    jobMapper.listDueImageOutpaintJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE, videoSubtitleEraseProducer.getIfAvailable(),
                    jobMapper.listDueVideoSubtitleEraseJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VIDEO_ENHANCE, videoEnhanceProducer.getIfAvailable(),
                    jobMapper.listDueVideoEnhanceJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VOCAL_SPLIT, vocalSplitProducer.getIfAvailable(),
                    jobMapper.listDueVocalSplitJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VIDEO_SCENE_SPLIT, videoSceneSplitProducer.getIfAvailable(),
                    jobMapper.listDueVideoSceneSplitJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VIDEO_MATTING, videoMattingProducer.getIfAvailable(),
                    jobMapper.listDueVideoMattingJobIds(SCAN_LIMIT, maxAgeMinutes));
            reenqueue(GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION, videoFrameInterpolationProducer.getIfAvailable(),
                    jobMapper.listDueVideoFrameInterpolationJobIds(SCAN_LIMIT, maxAgeMinutes));
        } catch (Exception e) {
            log.error("recovery scan failed: {}", e.getMessage(), e);
        }
    }

    /** 单 tag 重投：生产者缺失即跳过（防御性判断，正常装配下六类生产者恒在）。 */
    private void reenqueue(GenerationMqRouteEnum route, GenerationMessageProducer producer, List<Long> jobIds) {
        if (producer == null) {
            return;
        }
        for (Long jobId : jobIds) {
            try {
                log.info("recovery re-enqueue stuck {} job {}", route.tag(), jobId);
                producer.enqueue(String.valueOf(jobId), REENQUEUE_DELAY_MS);
            } catch (Exception e) {
                // 与 TS 同款：单条失败只记错，本轮后续继续、下轮扫描再试。
                log.error("recovery enqueue {} job {} failed: {}", route.tag(), jobId, e.getMessage(), e);
            }
        }
    }
}
