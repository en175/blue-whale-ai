package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VideoSubtitleEraseConsumer extends AbstractGenerationConsumer {

    private static final String TAG = VideoSubtitleEraseContract.TAG;

    private static final boolean DIGIT_GUARD = true;

    public VideoSubtitleEraseConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
