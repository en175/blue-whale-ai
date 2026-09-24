package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;

/**
 * 测试夹具：以指定 workerId 构造 {@link VideoJobProcessor}（IKIGYM）。
 * <p>
 * 带 workerId 的构造是包私有，仅供同包 {@code VideoJobProcessorTest} 直用；真库集成测试
 * {@code JobStateMachineMySqlIntegrationTest} 在 service 包，跨包经此桥接，以便两个
 * 不同 worker ID 的领取/发布身份可控可断言。
 */
public final class VideoJobProcessorFixtures {

    private VideoJobProcessorFixtures() {
    }

    public static VideoJobProcessor withWorkerId(
            JobStateMachineService stateMachine,
            AssetSourceService assetSource,
            GenerationCredentialService credentialService,
            NewApiVideoClient videoClient,
            TosVideoMediaRelay mediaRelay,
            GenerationMessageProducer producer,
            String workerId) {
        return new VideoJobProcessor(stateMachine, assetSource, credentialService,
                videoClient, mediaRelay, producer, workerId);
    }
}
