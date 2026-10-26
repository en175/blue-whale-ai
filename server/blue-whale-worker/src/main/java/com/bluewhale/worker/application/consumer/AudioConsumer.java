package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class AudioConsumer extends AbstractGenerationConsumer {

    private static final String TAG = GenerationMqRouteEnum.AUDIO.tag();

    private static final boolean DIGIT_GUARD = true;

    public AudioConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
