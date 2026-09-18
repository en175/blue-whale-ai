package com.bluewhale.worker.domain.entity;

/**
 * 生成作业类型枚举（契约 §2：generation_jobs.type 合法值）。
 * <p>
 * 变化轴：MQ tag / Processor / payload 扩展（契约附录 C：新类型 = 注册一套）。
 * 第 5 个生成类型产品已规划——新增类型先加本枚举项与对应 payload。
 */
public enum JobType {

    /** 图片生成（tag=image，Semaphore 20）。 */
    IMAGE("image"),

    /** 视频生成（tag=step，顺序派发）。 */
    VIDEO("video"),

    /** TTS 音频生成（tag=audio，Semaphore 5）。 */
    AUDIO("audio"),

    /** 视频/音频提取（tag=media_extract，Semaphore 2）。 */
    MEDIA_EXTRACT("media_extract"),

    /** 高清放大（tag=image_enhance，契约 §14 / IKGM8U；消费者与处理器由 IKGM9D 按附录 C 触点注册）。 */
    IMAGE_ENHANCE("image_enhance");

    private final String value;

    JobType(String value) {
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
