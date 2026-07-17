package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.dto.AssetObjectTransferHandle;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.ImageProviderCallService;
import com.blue.whale.agent.service.governance.ContentReviewOutcome;
import com.blue.whale.agent.service.governance.ContentReviewService;
import com.blue.whale.agent.service.governance.ReviewEvidenceRequest;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
public class GenerationWorker {

    private final GenerationJobClaimService claimService;
    private final GenerationResultAcceptanceService acceptanceService;
    private final GenerationProvider provider;
    private final GenerationStorage storage;
    private final SeedanceVideoGenerationProcessor videoProcessor;
    private final AssetObjectLifecycleService assetObjectLifecycleService;
    private final ImageProviderCallService imageProviderCallService;
    private final ContentReviewService contentReviewService;

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage) {
        this(claimService, acceptanceService, provider, storage, null, null, null, null);
    }

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor) {
        this(claimService, acceptanceService, provider, storage, videoProcessor, null, null, null);
    }

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor,
            AssetObjectLifecycleService assetObjectLifecycleService) {
        this(claimService, acceptanceService, provider, storage, videoProcessor,
                assetObjectLifecycleService, null, null);
    }

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor,
            AssetObjectLifecycleService assetObjectLifecycleService,
            ImageProviderCallService imageProviderCallService) {
        this(claimService, acceptanceService, provider, storage, videoProcessor,
                assetObjectLifecycleService, imageProviderCallService, null);
    }

    public GenerationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage,
            SeedanceVideoGenerationProcessor videoProcessor,
            AssetObjectLifecycleService assetObjectLifecycleService,
            ImageProviderCallService imageProviderCallService,
            ContentReviewService contentReviewService) {
        this.claimService = claimService;
        this.acceptanceService = acceptanceService;
        this.provider = provider;
        this.storage = storage;
        this.videoProcessor = videoProcessor;
        this.assetObjectLifecycleService = assetObjectLifecycleService;
        this.imageProviderCallService = imageProviderCallService;
        this.contentReviewService = contentReviewService;
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

        if (imageProviderCallService != null
                && imageProviderCallService.prepare(claim) != ImageProviderCallService.Preparation.CALL) {
            return true;
        }
        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                claim.projectId(), claim.userId(), claim.input()));
        if (imageProviderCallService != null) {
            imageProviderCallService.recordOutcome(claim, result.status().name().toLowerCase());
        }
        if (result.status() == GenerationProviderResult.Status.SUCCESS) {
            PreparedGenerationObject prepared = storage.prepare(result.content(), result.mimeType());
            AssetObjectTransferHandle transfer = assetObjectLifecycleService == null ? null
                    : assetObjectLifecycleService.beginTransfer(
                    prepared.storageKey(), Asset.SOURCE_GENERATED);
            StoredGenerationObject stored;
            try {
                stored = storage.store(prepared, result.content());
            } catch (RuntimeException exception) {
                if (transfer != null) {
                    assetObjectLifecycleService.failTransfer(transfer);
                }
                acceptanceService.acceptFailure(new GenerationFailureCommand(
                        claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                        claim.fencingToken(), claim.leaseOwner(),
                        "storage_failed", "生成结果存储失败"));
                return true;
            }
            // 供应商结果先作为私有、未接纳结果处理：只有 ContentReview decided + pass
            // 才允许创建 Asset（ADR-0022 / ADR-0029）；其余组合 fail closed。
            if (contentReviewService != null) {
                ContentReviewOutcome review = contentReviewService.reviewGeneratedImage(
                        new ReviewEvidenceRequest(
                                claim.projectId(), claim.userId(), claim.jobId(),
                                claim.targetSlotIndex(), stored.contentSha256(),
                                stored.mimeType(), claim.input()));
                if (review.status() != ContentReviewOutcome.Status.PASSED) {
                    if (transfer != null) {
                        assetObjectLifecycleService.failTransfer(transfer);
                    }
                    discardUnacceptedObject(stored.storageKey());
                    boolean rejected = review.status() == ContentReviewOutcome.Status.REJECTED;
                    acceptanceService.acceptFailure(new GenerationFailureCommand(
                            claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                            claim.fencingToken(), claim.leaseOwner(),
                            rejected ? "content_rejected" : "content_review_unavailable",
                            rejected ? "生成结果未通过内容审核" : "内容审核暂不可用"));
                    return true;
                }
            }
            try {
                if (transfer != null) {
                    assetObjectLifecycleService.completeTransfer(transfer, stored.contentSha256());
                }
            } catch (RuntimeException exception) {
                if (transfer != null) {
                    assetObjectLifecycleService.failTransfer(transfer);
                }
                acceptanceService.acceptFailure(new GenerationFailureCommand(
                        claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                        claim.fencingToken(), claim.leaseOwner(),
                        "storage_failed", "生成结果存储失败"));
                return true;
            }
            acceptanceService.acceptSuccess(new GenerationResultCommand(
                    claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                    claim.fencingToken(), claim.leaseOwner(),
                    deliveryId(claim), stored.storageKey(), stored.contentSha256(),
                    stored.mimeType(), stored.sizeBytes(), result.width(), result.height()));
            return true;
        }

        acceptanceService.acceptFailure(new GenerationFailureCommand(
                claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(),
                claim.fencingToken(), claim.leaseOwner(),
                result.errorCode(), result.errorMessage()));
        return true;
    }

    private void discardUnacceptedObject(String storageKey) {
        if (storage instanceof GenerationObjectDeletionStorage deletion) {
            deletion.delete(storageKey);
        }
    }

    private String deliveryId(GenerationJobClaim claim) {
        return "job-" + claim.jobId() + "-slot-" + claim.targetSlotIndex()
                + "-fence-" + claim.fencingToken();
    }
}
