package com.bluewhale.worker.domain.error;

public class MediaExtractError extends RuntimeException {

    public static final String INVALID_INPUT = "invalid_input";
    public static final String SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";
    public static final String MEDIA_EXTRACT_FAILED = "media_extract_failed";
    public static final String VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
    public static final String VIDEO_DOWNLOAD_FAILED = "video_download_failed";
    public static final String VIDEO_TOO_LARGE = "video_too_large";
    public static final String EXTRACT_FAILED = "extract_failed";
    public static final String UPLOAD_FAILED = "upload_failed";
    public static final String MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";

    private final String code;

    public MediaExtractError(String code, String message) {
        super(message);
        this.code = code;
    }

    public MediaExtractError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
