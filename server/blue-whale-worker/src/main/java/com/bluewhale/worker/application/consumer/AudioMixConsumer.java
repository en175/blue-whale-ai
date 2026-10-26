package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class AudioMixConsumer extends AbstractGenerationConsumer {
    public AudioMixConsumer(JobProcessor processor, String topic, ClientConfiguration config,
                            String group, int concurrency) {
        super(GenerationMqRouteEnum.AUDIO_MIX.tag(), false, processor, concurrency, topic, config, group);
    }
}
