package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.ImageOutpaintContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * image_outpaint（智能扩图）消费者（IKGOQW；以 imageEnhance/imageErase 接线为模板）。
 * <p>
 * tag = {@link ImageOutpaintContract#TAG}（转发 {@code GenerationMqRoute.IMAGE_OUTPAINT}）。
 * consumer group = "generation-image-outpaint-worker"（冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image/audio/enhance 守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(IMAGE_OUTPAINT_CONCURRENCY) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class ImageOutpaintConsumer extends AbstractGenerationConsumer {

    /** tag（= ImageOutpaintContract.TAG，与 JobType.IMAGE_OUTPAINT 同值）。 */
    private static final String TAG = ImageOutpaintContract.TAG;

    /** jobId 纯数字守卫（与 image/audio/enhance 一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public ImageOutpaintConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
