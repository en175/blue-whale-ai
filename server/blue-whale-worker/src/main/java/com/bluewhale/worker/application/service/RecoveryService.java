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

@Service
public class RecoveryService {

    private static final Logger log = LoggerFactory.getLogger(RecoveryService.class);

    private static final int SCAN_LIMIT = 100;

    private static final long REENQUEUE_DELAY_MS = 1000L;

    private final GenerationJobMapper jobMapper;
    private final ObjectProvider<GenerationMessageProducer> videoProducer;
    private final ObjectProvider<GenerationMessageProducer> imageProducer;
    private final ObjectProvider<GenerationMessageProducer> audioProducer;
    private final ObjectProvider<GenerationMessageProducer> mediaExtractProducer;
    private final ObjectProvider<GenerationMessageProducer> audioTrimProducer;
    private final ObjectProvider<GenerationMessageProducer> audioMixProducer;
    private final ObjectProvider<GenerationMessageProducer> audioVideoMuxProducer;
    private final ObjectProvider<GenerationMessageProducer> audioSpeedProducer;
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
            ObjectProvider<GenerationMessageProducer> videoFrameInterpolationProducer,
            @Value("${RECOVERY_MAX_AGE_MINUTES:120}") int maxAgeMinutes
    ) {
        this.jobMapper = jobMapper;
        this.videoProducer = videoProducer;
        this.imageProducer = imageProducer;
        this.audioProducer = audioProducer;
        this.mediaExtractProducer = mediaExtractProducer;
        this.audioTrimProducer = audioTrimProducer;
        this.audioMixProducer = audioMixProducer;
        this.audioVideoMuxProducer = audioVideoMuxProducer;
        this.audioSpeedProducer = audioSpeedProducer;
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
            reenqueue(GenerationMqRouteEnum.AUDIO_MIX, audioMixProducer.getIfAvailable(),
                    jobMapper.listDueAudioMixJobIds(SCAN_LIMIT, 0));
            reenqueue(GenerationMqRouteEnum.AUDIO_VIDEO_MUX, audioVideoMuxProducer.getIfAvailable(),
                    jobMapper.listDueAudioVideoMuxJobIds(SCAN_LIMIT, 0));
            reenqueue(GenerationMqRouteEnum.AUDIO_SPEED, audioSpeedProducer.getIfAvailable(),
                    jobMapper.listDueAudioSpeedJobIds(SCAN_LIMIT, maxAgeMinutes));
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

    private void reenqueue(GenerationMqRouteEnum route, GenerationMessageProducer producer, List<Long> jobIds) {
        if (producer == null) {
            return;
        }
        for (Long jobId : jobIds) {
            try {
                log.info("recovery re-enqueue stuck {} job {}", route.tag(), jobId);
                producer.enqueue(String.valueOf(jobId), REENQUEUE_DELAY_MS);
            } catch (Exception e) {
                log.error("recovery enqueue {} job {} failed: {}", route.tag(), jobId, e.getMessage(), e);
            }
        }
    }
}
