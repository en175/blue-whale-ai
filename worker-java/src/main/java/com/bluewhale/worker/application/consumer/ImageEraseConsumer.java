package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.ImageEraseContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * image_erase（图片擦除）消费者（契约 §15 / IKGOT6；以 imageEnhance/mediaExtract 接线为模板）。
 * <p>
 * tag = {@link ImageEraseContract#TAG}（转发 {@code GenerationMqRoute.IMAGE_ERASE}，契约 §15.1）。
 * consumer group = "generation-image-erase-worker"（契约 §15.1 冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image/imageEnhance 守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(IMAGE_ERASE_CONCURRENCY) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class ImageEraseConsumer extends AbstractGenerationConsumer {

    /** tag（= ImageEraseContract.TAG，queue.constants.ts IMAGE_ERASE_TAG 同值）。 */
    private static final String TAG = ImageEraseContract.TAG;

    /** jobId 纯数字守卫（与 image/imageEnhance 一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public ImageEraseConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
