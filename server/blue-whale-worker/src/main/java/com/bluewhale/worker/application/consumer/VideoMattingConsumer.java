package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * video_matting（智能抠像）消费者（IKHK99，父规格 IKHJRC，契约 IKHK7F；以 videoSceneSplit
 * 接线为模板）。
 * <p>
 * tag = {@link VideoMattingContract#TAG}（转发 {@code GenerationMqRoute.VIDEO_MATTING}）。
 * consumer group = "generation-video-matting-worker"（冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image 系守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore 并发 → fire-and-forget（抠像任务彼此独立，与视频生成
 *       的顺序派发不同——每次消费是独立的轻量 claim→submit/poll 步）</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class VideoMattingConsumer extends AbstractGenerationConsumer {

    /** tag（= VideoMattingContract.TAG，queue.constants.ts VIDEO_MATTING_TAG 同值）。 */
    private static final String TAG = VideoMattingContract.TAG;

    /** jobId 纯数字守卫（与 image 系一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public VideoMattingConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
