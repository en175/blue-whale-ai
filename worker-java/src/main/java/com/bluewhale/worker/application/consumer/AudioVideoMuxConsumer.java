package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/** 独立 audio_video_mux tag 的 RocketMQ 消费者。 */
public class AudioVideoMuxConsumer extends AbstractGenerationConsumer {
    public AudioVideoMuxConsumer(JobProcessor processor, String topic, ClientConfiguration config,
                                 String group, int concurrency) {
        super(GenerationMqRouteEnum.AUDIO_VIDEO_MUX.tag(), false, processor, concurrency, topic, config, group);
    }
}
