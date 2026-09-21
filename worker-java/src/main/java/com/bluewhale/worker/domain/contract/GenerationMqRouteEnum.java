package com.bluewhale.worker.domain.contract;

/**
 * 生成任务 MQ 路由表（topic + tag 单处定义；契约 §1 / ADR-0084 修正六）。
 * <p>
 * 七个入口一一对应七个消费者。{@link #tag()} 恒等于 {@code generation_jobs.type}
 * （即 {@link JobTypeEnum#value()}），取值是契约 §1 冻结的字面量——本枚举是该契约的可执行定义，
 * 生产侧（backend 的 queue.constants.ts）与消费侧都必须与它同值。
 * <p>
 * 错配即静默滞留：生产者的 tag 与消费者的 tag 不一致时，MQ 不报错、进程不报错、{@code /ready}
 * 也不报错——消息只是永远无人消费。故路由一律经本枚举取值，禁止在别处发明字面量。
 * <p>
 * {@link #topic()} 刻意逐入口声明而非抽成全局常量：当前七个 tag 共用同一个 topic，
 * 将来按类型拆 topic 时只改各入口的构造实参，不动结构。
 * <p>
 * 消费者组名（{@code generation-<type>-worker}）不在本枚举：组名与 topic/tag 的变化轴不同
 * （契约 §1 单列），仍由各 consumer bean 各自持有。
 */
public enum GenerationMqRouteEnum {

    /** 视频生成（多步任务，顺序派发）。 */
    VIDEO("generation-task", "video"),

    /** 图片生成。 */
    IMAGE("generation-task", "image"),

    /** TTS 音频生成。 */
    AUDIO("generation-task", "audio"),

    /** 视频/音频提取。 */
    MEDIA_EXTRACT("generation-task", "media_extract"),

    /** 音频截取（IKHB6S，父单 IKHB08；契约 = backend/libs/contracts/audio-trim.ts，ADR-0111）。 */
    AUDIO_TRIM("generation-task", "audio_trim"),

    /** 高清放大（契约 §14 / IKGM8U）。 */
    IMAGE_ENHANCE("generation-task", "image_enhance"),

    /** 图片擦除（契约 §15 / IKGOT3）。 */
    IMAGE_ERASE("generation-task", "image_erase"),

    /** 图片抠图（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXLS）。 */
    IMAGE_CUTOUT("generation-task", "image_cutout"),

    /** 智能扩图（IKGOQR 契约 = backend/libs/contracts/image-outpaint.ts）。 */
    IMAGE_OUTPAINT("generation-task", "image_outpaint"),

    /** 视频智能去字幕（迁移契约 §17 / IKGZ7Z；契约 = backend/libs/contracts/video-subtitle-erase.ts）。 */
    VIDEO_SUBTITLE_ERASE("generation-task", "video_subtitle_erase"),

    /** 视频 HD 高清（IKH3VE，父规格 IKH3VB；契约 = backend/libs/contracts/video-enhance.ts）。 */
    VIDEO_ENHANCE("generation-task", "video_enhance"),

    /** 人声背景分离（IKHA2C；契约 = backend/libs/contracts/vocal-split.ts）。 */
    VOCAL_SPLIT("generation-task", "vocal_split"),

    /** 视频场景切分（IKH8BH，父规格 IKH86V；契约 = backend/libs/contracts/video-scene-split.ts）。 */
    VIDEO_SCENE_SPLIT("generation-task", "video_scene_split");

    private final String topic;

    private final String tag;

    GenerationMqRouteEnum(String topic, String tag) {
        this.topic = topic;
        this.tag = tag;
    }

    /** MQ topic（当前七个入口共用 {@code generation-task}）。 */
    public String topic() {
        return topic;
    }

    /** MQ tag（= {@code generation_jobs.type}；生产者与消费者必须同值，错配即静默滞留）。 */
    public String tag() {
        return tag;
    }
}
