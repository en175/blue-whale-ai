package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/** 独立 audio_mix tag 的 RocketMQ 消费者。 */
public class AudioMixConsumer extends AbstractGenerationConsumer {
    public AudioMixConsumer(JobProcessor processor, String topic, ClientConfiguration config,
                            String group, int concurrency) {
        super(GenerationMqRouteEnum.AUDIO_MIX.tag(), false, processor, concurrency, topic, config, group);
    }
}
