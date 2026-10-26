package com.bluewhale.worker.domain.contract;

public enum JobTypeEnum {

    IMAGE("image"),

    VIDEO("video"),

    AUDIO("audio"),

    MEDIA_EXTRACT("media_extract"),

    AUDIO_MIX("audio_mix"),

    AUDIO_VIDEO_MUX("audio_video_mux"),

    AUDIO_TRIM("audio_trim"),

    AUDIO_SPEED("audio_speed"),

    IMAGE_ENHANCE("image_enhance"),

    IMAGE_ERASE("image_erase"),

    IMAGE_CUTOUT("image_cutout"),

    IMAGE_OUTPAINT("image_outpaint"),

    VIDEO_SUBTITLE_ERASE("video_subtitle_erase"),

    VIDEO_ENHANCE("video_enhance"),

    VOCAL_SPLIT("vocal_split"),

    VIDEO_SCENE_SPLIT("video_scene_split"),

    VIDEO_MATTING("video_matting"),

    VIDEO_FRAME_INTERPOLATION("video_frame_interpolation");

    private final String value;

    JobTypeEnum(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
