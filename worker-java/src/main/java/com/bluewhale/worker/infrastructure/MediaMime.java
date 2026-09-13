package com.bluewhale.worker.infrastructure;

/**
 * 媒体 MIME 常量（契约 §8：扩展名按 MIME 映射，TOS 落库字段）。
 * <p>
 * 变化轴：§8 媒体处理等价标准——audio 恒 audio/mpeg（data-direct）；参考视频 mime 白名单。
 * 值语义与 TS / DB 逐字一致，双端对账不可改字符串。
 */
public final class MediaMime {

    private MediaMime() {}

    /** 音频：data-direct base64 恒 audio/mpeg（契约 §8）。 */
    public static final String AUDIO_MPEG = "audio/mpeg";

    /** 图片 PNG（ImageIO 未知 image 回退 jpg，契约 §8）。 */
    public static final String IMAGE_PNG = "image/png";

    /** 图片 JPEG。 */
    public static final String IMAGE_JPEG = "image/jpeg";

    /** 视频 MP4。 */
    public static final String VIDEO_MP4 = "video/mp4";

    /** 视频 QuickTime。 */
    public static final String VIDEO_QUICKTIME = "video/quicktime";

    /** 参考视频允许 MIME 白名单（VideoJobProcessor / 上游参考校验）。 */
    public static final java.util.Set<String> REFERENCE_VIDEO_MIMES =
            java.util.Set.of(VIDEO_MP4, VIDEO_QUICKTIME);
}
