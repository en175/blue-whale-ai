package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;

public final class VideoJobProcessorFixtures {

    private VideoJobProcessorFixtures() {
    }

    public static VideoJobProcessor withWorkerId(
            JobStateMachineService stateMachine,
            JobFinalizer finalizer,
            AssetSourceService assetSource,
            UpstreamCredential upstreamCredential,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            GenerationMessageProducer producer,
            String workerId) {
        return new VideoJobProcessor(stateMachine, finalizer, assetSource, upstreamCredential,
                videoClient, mediaRelay, producer, workerId);
    }
}
