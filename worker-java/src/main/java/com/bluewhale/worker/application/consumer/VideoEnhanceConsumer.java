package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.VideoEnhanceContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * video_enhance（视频 HD 高清，火山 MediaKit 画质增强大模型版）消费者（IKH3VF，父规格
 * IKH3VB；以 videoSubtitleErase 接线为模板）。
 * <p>
 * tag = {@link VideoEnhanceContract#TAG}（转发 {@code GenerationMqRoute.VIDEO_ENHANCE}）。
 * consumer group = "generation-video-enhance-worker"（冻结值）。
 * digitGuard = true（generation_jobs.id 恒纯数字，与 image 系守卫一致）。
 * <p>
 * 与既有消费者行为一致（AbstractGenerationConsumer 模板）：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore 并发 → fire-and-forget（HD 高清任务彼此独立，
 *       与视频生成的顺序派发不同——每次消费是独立的轻量 claim→submit/poll 步）</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class VideoEnhanceConsumer extends AbstractGenerationConsumer {

    /** tag（= VideoEnhanceContract.TAG，queue.constants.ts VIDEO_ENHANCE_TAG 同值）。 */
    private static final String TAG = VideoEnhanceContract.TAG;

    /** jobId 纯数字守卫（与 image 系一致）。 */
    private static final boolean DIGIT_GUARD = true;

    public VideoEnhanceConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
