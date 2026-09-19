package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.ImageCutoutContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * image_cutout（图片抠图）消费者（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md /
 * IKGXM2；以 imageErase 接线为模板）。
 * <p>
 * tag = {@link ImageCutoutContract#TAG}（转发 {@code GenerationMqRoute.IMAGE_CUTOUT}）。
 * consumer group = "generation-image-cutout-worker"（契约冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image/imageErase 守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(IMAGE_CUTOUT_CONCURRENCY) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class ImageCutoutConsumer extends AbstractGenerationConsumer {

    /** tag（= ImageCutoutContract.TAG，queue.constants.ts IMAGE_CUTOUT_TAG 同值）。 */
    private static final String TAG = ImageCutoutContract.TAG;

    /** jobId 纯数字守卫（与 image/imageErase 一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public ImageCutoutConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
