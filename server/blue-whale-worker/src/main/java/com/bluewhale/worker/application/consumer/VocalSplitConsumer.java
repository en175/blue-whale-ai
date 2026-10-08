package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.VocalSplitContract;
import org.apache.rocketmq.client.apis.ClientConfiguration;

public class VocalSplitConsumer extends AbstractGenerationConsumer {

    private static final String TAG = VocalSplitContract.TAG;

    private static final boolean DIGIT_GUARD = true;

    public VocalSplitConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
