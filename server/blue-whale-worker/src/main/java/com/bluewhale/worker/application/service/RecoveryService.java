package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.function.IntFunction;

@Service
public class RecoveryService {

    private static final Logger log = LoggerFactory.getLogger(RecoveryService.class);

    private static final int SCAN_LIMIT = 100;

    private static final long REENQUEUE_DELAY_MS = 1000L;

    private final GenerationJobMapper jobMapper;
    private final JobFinalizer jobFinalizer;
    private final TerminalEventOutbox outbox;
    private final List<TypeScan> typeScans;

    private record TypeScan(GenerationMqRouteEnum route,
                            ObjectProvider<GenerationMessageProducer> producer,
                            IntFunction<List<Long>> due) {
    }

    public RecoveryService(
            GenerationJobMapper jobMapper,
            JobFinalizer jobFinalizer,
            TerminalEventOutbox outbox,
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
            @Qualifier("audioMixRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> audioMixProducer,
            @Qualifier("audioVideoMuxRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> audioVideoMuxProducer,
            @Qualifier("audioSpeedRecoveryProducer")
            ObjectProvider<GenerationMessageProducer> audioSpeedProducer,
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
            ObjectProvider<GenerationMessageProducer> videoFrameInterpolationProducer
    ) {
        this.jobMapper = jobMapper;
        this.jobFinalizer = jobFinalizer;
        this.outbox = outbox;
        this.typeScans = List.of(
                new TypeScan(GenerationMqRouteEnum.VIDEO, videoProducer, jobMapper::listDueVideoJobIds),
                new TypeScan(GenerationMqRouteEnum.IMAGE, imageProducer, jobMapper::listDueImageJobIds),
                new TypeScan(GenerationMqRouteEnum.AUDIO, audioProducer, jobMapper::listDueAudioJobIds),
                new TypeScan(GenerationMqRouteEnum.MEDIA_EXTRACT, mediaExtractProducer,
                        jobMapper::listDueMediaExtractJobIds),
                new TypeScan(GenerationMqRouteEnum.AUDIO_TRIM, audioTrimProducer,
                        jobMapper::listDueAudioTrimJobIds),
                new TypeScan(GenerationMqRouteEnum.AUDIO_MIX, audioMixProducer,
                        jobMapper::listDueAudioMixJobIds),
                new TypeScan(GenerationMqRouteEnum.AUDIO_VIDEO_MUX, audioVideoMuxProducer,
                        jobMapper::listDueAudioVideoMuxJobIds),
                new TypeScan(GenerationMqRouteEnum.AUDIO_SPEED, audioSpeedProducer,
                        jobMapper::listDueAudioSpeedJobIds),
                new TypeScan(GenerationMqRouteEnum.IMAGE_ENHANCE, imageEnhanceProducer,
                        jobMapper::listDueImageEnhanceJobIds),
                new TypeScan(GenerationMqRouteEnum.IMAGE_ERASE, imageEraseProducer,
                        jobMapper::listDueImageEraseJobIds),
                new TypeScan(GenerationMqRouteEnum.IMAGE_CUTOUT, imageCutoutProducer,
                        jobMapper::listDueImageCutoutJobIds),
                new TypeScan(GenerationMqRouteEnum.IMAGE_OUTPAINT, imageOutpaintProducer,
                        jobMapper::listDueImageOutpaintJobIds),
                new TypeScan(GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE, videoSubtitleEraseProducer,
                        jobMapper::listDueVideoSubtitleEraseJobIds),
                new TypeScan(GenerationMqRouteEnum.VIDEO_ENHANCE, videoEnhanceProducer,
                        jobMapper::listDueVideoEnhanceJobIds),
                new TypeScan(GenerationMqRouteEnum.VOCAL_SPLIT, vocalSplitProducer,
                        jobMapper::listDueVocalSplitJobIds),
                new TypeScan(GenerationMqRouteEnum.VIDEO_SCENE_SPLIT, videoSceneSplitProducer,
                        jobMapper::listDueVideoSceneSplitJobIds),
                new TypeScan(GenerationMqRouteEnum.VIDEO_MATTING, videoMattingProducer,
                        jobMapper::listDueVideoMattingJobIds),
                new TypeScan(GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION, videoFrameInterpolationProducer,
                        jobMapper::listDueVideoFrameInterpolationJobIds));
    }

    @Scheduled(
            initialDelayString = "${GENERATION_RECOVERY_INITIAL_DELAY_MS:0}",
            fixedDelayString = "${GENERATION_RECOVERY_INTERVAL_MS:60000}"
    )
    public void recover() {
        try {
            for (TypeScan scan : typeScans) {
                reenqueue(scan.route(), scan.producer().getIfAvailable(), scan.due().apply(SCAN_LIMIT));
            }
            reenqueueRequestedCancels();
            expireOverdue();
            outbox.drain(SCAN_LIMIT);
        } catch (Exception e) {
            log.error("协调器扫描失败: {}", e.getMessage(), e);
        }
    }

    private void reenqueue(GenerationMqRouteEnum route, GenerationMessageProducer producer, List<Long> jobIds) {
        if (producer == null) {
            return;
        }
        for (Long jobId : jobIds) {
            try {
                log.info("协调器重投排队中的 {} 任务 {}", route.tag(), jobId);
                producer.enqueue(String.valueOf(jobId), REENQUEUE_DELAY_MS);
            } catch (Exception e) {
                log.error("协调器重投 {} 任务 {} 失败（只记日志，任务上界由执行截止时间决定）：{}",
                        route.tag(), jobId, e.getMessage(), e);
            }
        }
    }

    private void reenqueueRequestedCancels() {
        for (GenerationJobEntity job : jobMapper.listCancelPendingJobs(SCAN_LIMIT)) {
            GenerationMessageProducer producer = producerFor(job.getType());
            if (producer == null) {
                log.warn("取消补投找不到对应生产者，跳过：jobId={} type={}", job.getId(), job.getType());
                continue;
            }
            try {
                log.info("协调器补投已请求取消的排队任务 {}", job.getId());
                producer.enqueue(String.valueOf(job.getId()), REENQUEUE_DELAY_MS);
            } catch (Exception e) {
                log.error("取消补投失败（只记日志）：jobId={} {}", job.getId(), e.getMessage(), e);
            }
        }
    }

    private void expireOverdue() {
        for (Long jobId : jobMapper.listExpiredJobIds(SCAN_LIMIT)) {
            try {
                jobFinalizer.expireJob(String.valueOf(jobId));
            } catch (Exception e) {
                log.error("超期任务收口失败：jobId={} {}", jobId, e.getMessage(), e);
            }
        }
    }

    private GenerationMessageProducer producerFor(String type) {
        for (TypeScan scan : typeScans) {
            if (scan.route().tag().equals(type)) {
                return scan.producer().getIfAvailable();
            }
        }
        return null;
    }
}
