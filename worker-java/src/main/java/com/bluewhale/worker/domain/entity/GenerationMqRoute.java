package com.bluewhale.worker.domain.entity;

/**
 * 生成任务 MQ 路由表（topic + tag 单处定义；契约 §1 / ADR-0084 修正六）。
 * <p>
 * 六个入口一一对应六个消费者。{@link #tag()} 恒等于 {@code generation_jobs.type}
 * （即 {@link JobType#value()}），取值是契约 §1 冻结的字面量——本枚举是该契约的可执行定义，
 * 生产侧（backend 的 queue.constants.ts）与消费侧都必须与它同值。
 * <p>
 * 错配即静默滞留：生产者的 tag 与消费者的 tag 不一致时，MQ 不报错、进程不报错、{@code /ready}
 * 也不报错——消息只是永远无人消费。故路由一律经本枚举取值，禁止在别处发明字面量。
 * <p>
 * {@link #topic()} 刻意逐入口声明而非抽成全局常量：当前六个 tag 共用同一个 topic，
 * 将来按类型拆 topic 时只改各入口的构造实参，不动结构。
 * <p>
 * 消费者组名（{@code generation-<type>-worker}）不在本枚举：组名与 topic/tag 的变化轴不同
 * （契约 §1 单列），仍由各 consumer bean 各自持有。
 */
public enum GenerationMqRoute {

    /** 视频生成（多步任务，顺序派发）。 */
    VIDEO("generation-task", "video"),

    /** 图片生成。 */
    IMAGE("generation-task", "image"),

    /** TTS 音频生成。 */
    AUDIO("generation-task", "audio"),

    /** 视频/音频提取。 */
    MEDIA_EXTRACT("generation-task", "media_extract"),

    /** 高清放大（契约 §14 / IKGM8U）。 */
    IMAGE_ENHANCE("generation-task", "image_enhance"),

    /** 图片擦除（契约 §15 / IKGOT3）。 */
    IMAGE_ERASE("generation-task", "image_erase");

    private final String topic;

    private final String tag;

    GenerationMqRoute(String topic, String tag) {
        this.topic = topic;
        this.tag = tag;
    }

    /** MQ topic（当前六个入口共用 {@code generation-task}）。 */
    public String topic() {
        return topic;
    }

    /** MQ tag（= {@code generation_jobs.type}；生产者与消费者必须同值，错配即静默滞留）。 */
    public String tag() {
        return tag;
    }
}
