package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.ImageEnhanceContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * image_enhance（高清放大）消费者（契约 §14 / IKGM9D；以 mediaExtract/audio 接线为模板）。
 * <p>
 * tag = "image_enhance"（复用 topic generation-video，契约 §14.1）。
 * consumer group = "generation-image-enhance-worker" + groupSuffix（契约 §14.1 冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image/audio 守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(IMAGE_ENHANCE_CONCURRENCY) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class ImageEnhanceConsumer extends AbstractGenerationConsumer {

    /** tag（= ImageEnhanceContract.TAG，queue.constants.ts IMAGE_ENHANCE_TAG 同值）。 */
    private static final String TAG = ImageEnhanceContract.TAG;

    /** jobId 纯数字守卫（与 image/audio 一致；extract 的 false 是 TS 历史形态，新类型不沿用）。 */
    private static final boolean DIGIT_GUARD = true;

    public ImageEnhanceConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
