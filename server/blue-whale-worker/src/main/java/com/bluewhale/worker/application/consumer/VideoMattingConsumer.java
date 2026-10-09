package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VideoMattingConsumer extends AbstractGenerationConsumer {

    private static final String TAG = VideoMattingContract.TAG;

    private static final boolean DIGIT_GUARD = true;

    public VideoMattingConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
