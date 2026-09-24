package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * audio_speed（音频调速）消费者（IKHW5A，父单 IKHVYO；AudioTrimConsumer 同款模板）。
 * <p>
 * tag = {@link GenerationMqRouteEnum#AUDIO_SPEED}，digitGuard = false（不套纯数字守卫，
 * 与 media_extract / audio_trim 一致——只查 typeof body.jobId === "string"）。
 * consumer group = "generation-audio-speed-worker"。
 * <p>
 * 行为与家族完全一致：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(并发度) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非字符串 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class AudioSpeedConsumer extends AbstractGenerationConsumer {

    /** tag（{@link GenerationMqRouteEnum#AUDIO_SPEED}；= TS {@code AUDIO_SPEED_TAG}）。 */
    private static final String TAG = GenerationMqRouteEnum.AUDIO_SPEED.tag();

    /**
     * audio_speed 不做 digitGuard（AudioTrimConsumer 同款）：
     * 仅 typeof body.jobId === "string" 检查，不要求纯数字。
     */
    private static final boolean DIGIT_GUARD = false;

    public AudioSpeedConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
