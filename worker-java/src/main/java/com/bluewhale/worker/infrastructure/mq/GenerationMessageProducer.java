package com.bluewhale.worker.infrastructure.mq;

/**
 * MQ 消息生产者端口（video-queue.ts:48-64 createRocketMqVideoProducer 逐字移植）。
 * <p>
 * 视频路径专用：submit 成功后 scheduleNext(5s)、rescheduleVideoPoll 续排、
 * parent-reuse 后续排。每次 step 完成后 processor 自投延迟消息到同一 topic/tag，
 * 下轮消费者 claim-by-id 孤儿接管驱动。
 * <p>
 * <b>仅 VideoJobProcessor 注入</b>（extract/audio/image 不自投——它们的编排是单次完成）。
 * <p>
 * 消息体：{@code {"jobId":"<string>"}}（与消费者端 GenerationMessage.parse 对称）。
 * delay 下限 VIDEO_MIN_DELAY_MS=1000ms（video-queue.ts:17）。
 * <p>
 * 实现：RocketMqGenerationMessageProducer 包 rocketmq-client-java Producer。
 * 测试：mock 此接口断言 send 参数（message shape + delay）。
 */
public interface GenerationMessageProducer {

    /**
     * 入队延迟消息（video-queue.ts:54-62 enqueue）。
     *
     * @param jobId   作业 ID
     * @param delayMs 延迟毫秒（≤0 时钳制到 VIDEO_MIN_DELAY_MS=1000）
     */
    void enqueue(String jobId, long delayMs);

    /** 关闭生产者（video-queue.ts:157-169 closeVideoGenerationQueue）。 */
    void close();
}
