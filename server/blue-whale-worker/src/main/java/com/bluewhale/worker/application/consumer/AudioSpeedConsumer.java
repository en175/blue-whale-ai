package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class AudioSpeedConsumer extends AbstractGenerationConsumer {

    private static final String TAG = GenerationMqRouteEnum.AUDIO_SPEED.tag();

    private static final boolean DIGIT_GUARD = false;

    public AudioSpeedConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
