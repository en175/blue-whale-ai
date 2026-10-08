package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoEnhanceContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VideoEnhanceConsumer extends AbstractGenerationConsumer {

    private static final String TAG = VideoEnhanceContract.TAG;

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
