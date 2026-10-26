package com.bluewhale.worker.infrastructure;

public final class MediaMime {

    private MediaMime() {}

    public static final String AUDIO_MPEG = "audio/mpeg";

    public static final String IMAGE_PNG = "image/png";

    public static final String IMAGE_JPEG = "image/jpeg";

    public static final String VIDEO_MP4 = "video/mp4";

    public static final String VIDEO_QUICKTIME = "video/quicktime";

    public static final java.util.Set<String> REFERENCE_VIDEO_MIMES =
            java.util.Set.of(VIDEO_MP4, VIDEO_QUICKTIME);
}
