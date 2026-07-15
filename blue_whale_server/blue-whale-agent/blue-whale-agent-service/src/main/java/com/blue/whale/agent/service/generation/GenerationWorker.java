package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
public class GenerationWorker {

    private final GenerationJobClaimService claimService;
    private final GenerationResultAcceptanceService acceptanceService;
    private final GenerationProvider provider;
    private final GenerationStorage storage;
    private final SeedanceVideoGenerationProcessor videoProcessor;

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage) {
        this(claimService, acceptanceService, provider, storage, null);
    }

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor) {
        this.claimService = claimService;
        this.acceptanceService = acceptanceService;
        this.provider = provider;
        this.storage = storage;
        this.videoProcessor = videoProcessor;
    }

    public boolean runOnce(String workerId) {
        GenerationJobClaim claim;
        try {
            claim = claimService.claim(workerId);
        } catch (GlobalException exception) {
            if (exception.getCode() == SystemCode.RESOURCE_NOT_FOUND_CODE) {
                return false;
            }
            throw exception;
        }

        if ("video".equals(claim.type())) {
            if (videoProcessor == null) {
                throw new IllegalStateException("视频 Generation Worker 未配置");
            }
            videoProcessor.process(claim);
            return true;
        }

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                claim.projectId(), claim.userId(), claim.input()));
        if (result.status() == GenerationProviderResult.Status.SUCCESS) {
            StoredGenerationObject stored;
            try {
                stored = storage.store(result.content(), result.mimeType());
            } catch (RuntimeException exception) {
                acceptanceService.acceptFailure(new GenerationFailureCommand(
                        claim.jobId(), claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                        "storage_failed", "生成结果存储失败"));
                return true;
            }
            acceptanceService.acceptSuccess(new GenerationResultCommand(
                    claim.jobId(), 0, claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                    deliveryId(claim), stored.storageKey(), stored.contentSha256(),
                    stored.mimeType(), stored.sizeBytes(), result.width(), result.height()));
            return true;
        }

        acceptanceService.acceptFailure(new GenerationFailureCommand(
                claim.jobId(), claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                result.errorCode(), result.errorMessage()));
        return true;
    }

    private String deliveryId(GenerationJobClaim claim) {
        return "job-" + claim.jobId() + "-fence-" + claim.fencingToken();
    }
}
