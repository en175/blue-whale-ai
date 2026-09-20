package com.bluewhale.worker.domain.contract;

/**
 * 生成作业类型枚举（契约 §2：generation_jobs.type 合法值）。
 * <p>
 * 变化轴：MQ tag / Processor / payload 扩展（契约附录 C：新类型 = 注册一套）。
 * 第 5 个生成类型产品已规划——新增类型先加本枚举项与对应 payload。
 */
public enum JobTypeEnum {

    /** 图片生成（tag=image，Semaphore 20）。 */
    IMAGE("image"),

    /** 视频生成（tag=video，顺序派发）。 */
    VIDEO("video"),

    /** TTS 音频生成（tag=audio，Semaphore 5）。 */
    AUDIO("audio"),

    /** 视频/音频提取（tag=media_extract，Semaphore 2）。 */
    MEDIA_EXTRACT("media_extract"),

    /** 音频截取（tag=audio_trim，画布音频卡「截取」，Semaphore 2；契约 =
     * backend/libs/contracts/audio-trim.ts，ADR-0111；消费者与处理器由 IKHB6S 按附录 C 触点注册）。 */
    AUDIO_TRIM("audio_trim"),

    /** 高清放大（tag=image_enhance，契约 §14 / IKGM8U；消费者与处理器由 IKGM9D 按附录 C 触点注册）。 */
    IMAGE_ENHANCE("image_enhance"),

    /** 图片擦除（tag=image_erase，契约 §15 / IKGOT3；消费者与处理器由 IKGOT6 按附录 C 触点注册）。 */
    IMAGE_ERASE("image_erase"),

    /** 图片抠图（tag=image_cutout，契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXLS；
     *  消费者与处理器由 IKGXM2 按附录 C 触点注册）。 */
    IMAGE_CUTOUT("image_cutout"),

    /** 智能扩图（tag=image_outpaint，IKGOQR 契约 = backend/libs/contracts/image-outpaint.ts；
     *  规格见 docs/specs/2026-09-18-image-outpaint-mediakit.md；消费者与处理器由后续票按附录 C 触点注册）。 */
    IMAGE_OUTPAINT("image_outpaint"),

    /** 视频智能去字幕（tag=video_subtitle_erase，迁移契约 §17 / IKGZ7Z；契约 =
     *  backend/libs/contracts/video-subtitle-erase.ts，规格见 docs/specs/2026-09-19-video-subtitle-erase-mediakit.md；
     *  消费者与处理器由 Z81 按附录 C 触点注册）。 */
    VIDEO_SUBTITLE_ERASE("video_subtitle_erase"),

    /** 视频 HD 高清（tag=video_enhance，IKH3VE，父规格 IKH3VB；契约 =
     *  backend/libs/contracts/video-enhance.ts，火山 MediaKit 画质增强大模型版）；
     *  消费者与处理器由 worker 票按附录 C 触点注册。 */
    VIDEO_ENHANCE("video_enhance");

    private final String value;

    JobTypeEnum(String value) {
        this.value = value;
    }

    /** DB 合法值（与 schema.prisma / TS 一致）。 */
    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
