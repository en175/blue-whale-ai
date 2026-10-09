package com.bluewhale.worker.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "worker")
public record WorkerProperties(
        Concurrency concurrency) {

    public WorkerProperties {
        concurrency = concurrency == null
                ? new Concurrency(20, 5, 2, 2, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5) : concurrency;
    }

    public record Concurrency(int image, int audio, int mediaExtract, int audioTrim, int audioSpeed,
                              int imageEnhance, int imageErase, int imageCutout, int imageOutpaint,
                              int videoSubtitleErase, int videoEnhance,
                              int vocalSplit, int videoSceneSplit, int videoMatting,
                              int videoFrameInterpolation) {
        public Concurrency {
            if (image < 1 || image > 64) {
                throw new IllegalArgumentException("IMAGE_CONCURRENCY 超出 1-64 范围: " + image);
            }
            if (audio < 1 || audio > 64) {
                throw new IllegalArgumentException("AUDIO_CONCURRENCY 超出 1-64 范围: " + audio);
            }
            if (mediaExtract < 1 || mediaExtract > 16) {
                throw new IllegalArgumentException("MEDIA_EXTRACT_CONCURRENCY 超出 1-16 范围: " + mediaExtract);
            }
            if (audioTrim < 1 || audioTrim > 16) {
                throw new IllegalArgumentException("AUDIO_TRIM_CONCURRENCY 超出 1-16 范围: " + audioTrim);
            }
            if (audioSpeed < 1 || audioSpeed > 16) {
                throw new IllegalArgumentException("AUDIO_SPEED_CONCURRENCY 超出 1-16 范围: " + audioSpeed);
            }
            if (imageEnhance < 1 || imageEnhance > 64) {
                throw new IllegalArgumentException("IMAGE_ENHANCE_CONCURRENCY 超出 1-64 范围: " + imageEnhance);
            }
            if (imageErase < 1 || imageErase > 64) {
                throw new IllegalArgumentException("IMAGE_ERASE_CONCURRENCY 超出 1-64 范围: " + imageErase);
            }
            if (imageCutout < 1 || imageCutout > 64) {
                throw new IllegalArgumentException("IMAGE_CUTOUT_CONCURRENCY 超出 1-64 范围: " + imageCutout);
            }
            if (imageOutpaint < 1 || imageOutpaint > 64) {
                throw new IllegalArgumentException("IMAGE_OUTPAINT_CONCURRENCY 超出 1-64 范围: " + imageOutpaint);
            }
            if (videoSubtitleErase < 1 || videoSubtitleErase > 64) {
                throw new IllegalArgumentException("VIDEO_SUBTITLE_ERASE_CONCURRENCY 超出 1-64 范围: " + videoSubtitleErase);
            }
            if (videoEnhance < 1 || videoEnhance > 64) {
                throw new IllegalArgumentException("VIDEO_ENHANCE_CONCURRENCY 超出 1-64 范围: " + videoEnhance);
            }
            if (vocalSplit < 1 || vocalSplit > 64) {
                throw new IllegalArgumentException("VOCAL_SPLIT_CONCURRENCY 超出 1-64 范围: " + vocalSplit);
            }
            if (videoSceneSplit < 1 || videoSceneSplit > 64) {
                throw new IllegalArgumentException("VIDEO_SCENE_SPLIT_CONCURRENCY 超出 1-64 范围: " + videoSceneSplit);
            }
            if (videoMatting < 1 || videoMatting > 64) {
                throw new IllegalArgumentException("VIDEO_MATTING_CONCURRENCY 超出 1-64 范围: " + videoMatting);
            }
            if (videoFrameInterpolation < 1 || videoFrameInterpolation > 64) {
                throw new IllegalArgumentException("VIDEO_FRAME_INTERPOLATION_CONCURRENCY 超出 1-64 范围: " + videoFrameInterpolation);
            }
        }
    }
}
