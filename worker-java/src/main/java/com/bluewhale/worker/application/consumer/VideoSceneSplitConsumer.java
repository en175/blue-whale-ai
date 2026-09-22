package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * video_scene_split（视频场景切分）消费者（IKH8BP，父规格 IKH86V；以 videoEnhance 接线为模板）。
 * <p>
 * tag = {@link VideoSceneSplitContract#TAG}（转发 {@code GenerationMqRoute.VIDEO_SCENE_SPLIT}）。
 * consumer group = "generation-video-scene-split-worker"（冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image 系守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore 并发 → fire-and-forget（切分任务彼此独立，
 *       与视频生成的顺序派发不同——每次消费是独立的轻量 claim→submit/poll 步）</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class VideoSceneSplitConsumer extends AbstractGenerationConsumer {

    /** tag（= VideoSceneSplitContract.TAG，queue.constants.ts VIDEO_SCENE_SPLIT_TAG 同值）。 */
    private static final String TAG = VideoSceneSplitContract.TAG;

    /** jobId 纯数字守卫（与 image 系一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public VideoSceneSplitConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
