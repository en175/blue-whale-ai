package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VideoSceneSplitConsumer extends AbstractGenerationConsumer {

    private static final String TAG = VideoSceneSplitContract.TAG;

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
