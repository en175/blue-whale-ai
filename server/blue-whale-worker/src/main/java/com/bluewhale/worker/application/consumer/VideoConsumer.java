package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VideoConsumer extends AbstractGenerationConsumer {

    public static final String TAG = GenerationMqRouteEnum.VIDEO.tag();

    private static final int SEQUENTIAL_CONCURRENCY = 1;

    public VideoConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup
    ) {
        super(TAG, false, processor, SEQUENTIAL_CONCURRENCY, topic, clientConfig, consumerGroup);
    }
}
