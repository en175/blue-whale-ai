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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
        if (isSequential(claim.input())) {
            return runSequential(claim);
        }
        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                claim.projectId(), claim.userId(), claim.input()));
        if (imageProviderCallService != null) {
            imageProviderCallService.recordOutcome(claim, result.status().name().toLowerCase());
        }
        if (result.status() == GenerationProviderResult.Status.SUCCESS) {
            acceptSingleImage(claim, result.images().get(0));
            return true;
        }

        acceptanceService.acceptFailure(buildFailureCommand(
                claim, claim.targetSlotIndex(), result.errorCode(), result.errorMessage()));
        return true;
    }

    /**
     * 组图模式（IK24Q9）：单次方舟调用产 N 张关联图，分别回填 Job 的 N 个 pending 槽。
     * claim0 的 fence/lease/version 全程保持（acceptSequentialSlot/Failure 不动 job），
     * 最后 finalizeSequentialJob 一次 aggregate 算终态。
     */
    private boolean runSequential(GenerationJobClaim claim) {
        List<Integer> pendingSlots = claimService.pendingSlotIndexes(claim.jobId());
        if (pendingSlots.isEmpty()) {
            acceptanceService.finalizeSequentialJob(claim.jobId(), claim.fencingToken());
            return true;
        }
        int slotCount = pendingSlots.size();
        Map<String, Object> seqInput = new LinkedHashMap<>(claim.input());
        seqInput.put("max_images", slotCount);
        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                claim.projectId(), claim.userId(), seqInput));
        if (imageProviderCallService != null) {
            imageProviderCallService.recordOutcome(claim, result.status().name().toLowerCase());
        }
        if (result.status() == GenerationProviderResult.Status.SUCCESS) {
            List<GenerationProviderResult.ImageResult> images = result.images();
            for (int i = 0; i < slotCount; i++) {
                int slot = pendingSlots.get(i);
                if (i < images.size()) {
                    acceptSequentialImage(claim, images.get(i), slot);
                } else {
                    acceptanceService.acceptSequentialFailure(buildFailureCommand(
                            claim, slot, "no_result", "组图未返回该槽结果"));
                }
            }
        } else {
            String errorCode = result.status() == GenerationProviderResult.Status.FAILURE
                    ? result.errorCode() : "no_result";
            String errorMessage = result.status() == GenerationProviderResult.Status.FAILURE
                    ? result.errorMessage() : "组图未返回结果";
            for (int slot : pendingSlots) {
                acceptanceService.acceptSequentialFailure(buildFailureCommand(
                        claim, slot, errorCode, errorMessage));
            }
        }
        acceptanceService.finalizeSequentialJob(claim.jobId(), claim.fencingToken());
        return true;
    }

    private void acceptSingleImage(GenerationJobClaim claim, GenerationProviderResult.ImageResult image) {
        StoredGenerationObject stored = storeAndReview(claim, image, claim.targetSlotIndex(), false);
        if (stored == null) {
            return;
        }
        acceptanceService.acceptSuccess(buildResultCommand(
                claim, claim.targetSlotIndex(), stored, image));
    }

    private void acceptSequentialImage(
            GenerationJobClaim claim, GenerationProviderResult.ImageResult image, int slotIndex) {
        StoredGenerationObject stored = storeAndReview(claim, image, slotIndex, true);
        if (stored == null) {
            return;
        }
        acceptanceService.acceptSequentialSlot(buildResultCommand(claim, slotIndex, stored, image));
    }

    /**
     * 供应商结果落存储 + 内容审核；PASSED 返回 stored，其余分支已调对应 accept 失败命令并返回 null。
     *
     * @param sequential true 走组图接纳（acceptSequentialFailure），false 走单图接纳（acceptFailure）
     */
    private StoredGenerationObject storeAndReview(
            GenerationJobClaim claim, GenerationProviderResult.ImageResult image,
            int slotIndex, boolean sequential) {
        PreparedGenerationObject prepared = storage.prepare(image.content(), image.mimeType());
        AssetObjectTransferHandle transfer = assetObjectLifecycleService == null ? null
                : assetObjectLifecycleService.beginTransfer(
                prepared.storageKey(), Asset.SOURCE_GENERATED);
        StoredGenerationObject stored;
        try {
            stored = storage.store(prepared, image.content());
        } catch (RuntimeException exception) {
            if (transfer != null) {
                assetObjectLifecycleService.failTransfer(transfer);
            }
            acceptStorageFailure(claim, slotIndex, sequential, "storage_failed", "生成结果存储失败");
            return null;
        }
        // 供应商结果先作为私有、未接纳结果处理：只有 ContentReview decided + pass
        // 才允许创建 Asset（ADR-0022 / ADR-0029）；其余组合 fail closed。
        ContentReviewOutcome review = contentReviewService.reviewGeneratedImage(
                new ReviewEvidenceRequest(
                        claim.projectId(), claim.userId(), claim.jobId(),
                        slotIndex, stored.contentSha256(),
                        stored.mimeType(), claim.input()));
        if (review.status() != ContentReviewOutcome.Status.PASSED) {
            if (transfer != null) {
                assetObjectLifecycleService.failTransfer(transfer);
            }
            discardUnacceptedObject(stored.storageKey());
            boolean rejected = review.status() == ContentReviewOutcome.Status.REJECTED;
            acceptStorageFailure(claim, slotIndex, sequential,
                    rejected ? "content_rejected" : "content_review_unavailable",
                    rejected ? "生成结果未通过内容审核" : "内容审核暂不可用");
            return null;
        }
        try {
            if (transfer != null) {
                assetObjectLifecycleService.completeTransfer(transfer, stored.contentSha256());
            }
        } catch (RuntimeException exception) {
            if (transfer != null) {
                assetObjectLifecycleService.failTransfer(transfer);
            }
            acceptStorageFailure(claim, slotIndex, sequential, "storage_failed", "生成结果存储失败");
            return null;
        }
        return stored;
    }

    private void acceptStorageFailure(
            GenerationJobClaim claim, int slotIndex, boolean sequential,
            String errorCode, String errorMessage) {
        GenerationFailureCommand command = buildFailureCommand(claim, slotIndex, errorCode, errorMessage);
        if (sequential) {
            acceptanceService.acceptSequentialFailure(command);
        } else {
            acceptanceService.acceptFailure(command);
        }
    }

    private void discardUnacceptedObject(String storageKey) {
        if (storage instanceof GenerationObjectDeletionStorage deletion) {
            deletion.delete(storageKey);
        }
    }

    private GenerationResultCommand buildResultCommand(
            GenerationJobClaim claim, int slotIndex,
            StoredGenerationObject stored, GenerationProviderResult.ImageResult image) {
        return new GenerationResultCommand(
                claim.jobId(), slotIndex, claim.jobVersion(),
                claim.fencingToken(), claim.leaseOwner(),
                deliveryId(claim, slotIndex), stored.storageKey(), stored.contentSha256(),
                stored.mimeType(), stored.sizeBytes(), image.width(), image.height());
    }

    private GenerationFailureCommand buildFailureCommand(
            GenerationJobClaim claim, int slotIndex, String errorCode, String errorMessage) {
        return new GenerationFailureCommand(
                claim.jobId(), slotIndex, claim.jobVersion(),
                claim.fencingToken(), claim.leaseOwner(),
                errorCode, errorMessage);
    }

    private boolean isSequential(Map<String, Object> input) {
        return input != null && Boolean.TRUE.equals(input.get("sequential_image_generation"));
    }

    private String deliveryId(GenerationJobClaim claim, int slotIndex) {
        return "job-" + claim.jobId() + "-slot-" + slotIndex
                + "-fence-" + claim.fencingToken();
    }
}
