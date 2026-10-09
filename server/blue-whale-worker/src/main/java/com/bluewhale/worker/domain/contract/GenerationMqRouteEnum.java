package com.bluewhale.worker.domain.contract;

public enum GenerationMqRouteEnum {

    VIDEO("generation-task", "video"),

    IMAGE("generation-task", "image"),

    AUDIO("generation-task", "audio"),

    MEDIA_EXTRACT("generation-task", "media_extract"),

    AUDIO_MIX("generation-task", "audio_mix"),

    AUDIO_VIDEO_MUX("generation-task", "audio_video_mux"),

    AUDIO_TRIM("generation-task", "audio_trim"),

    AUDIO_SPEED("generation-task", "audio_speed"),

    IMAGE_ENHANCE("generation-task", "image_enhance"),

    IMAGE_ERASE("generation-task", "image_erase"),

    IMAGE_CUTOUT("generation-task", "image_cutout"),

    IMAGE_OUTPAINT("generation-task", "image_outpaint"),

    VIDEO_SUBTITLE_ERASE("generation-task", "video_subtitle_erase"),

    VIDEO_ENHANCE("generation-task", "video_enhance"),

    VOCAL_SPLIT("generation-task", "vocal_split"),

    VIDEO_SCENE_SPLIT("generation-task", "video_scene_split"),

    VIDEO_MATTING("generation-task", "video_matting"),

    VIDEO_FRAME_INTERPOLATION("generation-task", "video_frame_interpolation");

    private final String topic;

    private final String tag;

    GenerationMqRouteEnum(String topic, String tag) {
        this.topic = topic;
        this.tag = tag;
    }

    public String topic() {
        return topic;
    }

    public String tag() {
        return tag;
    }
}
