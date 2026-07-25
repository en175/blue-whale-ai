package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.AssetObjectDeletionClaim;
import com.blue.whale.agent.service.AssetObjectLifecycleService;

public class AssetObjectGarbageCollector {

    private final AssetObjectLifecycleService lifecycleService;
    private final GenerationObjectDeletionStorage storage;

    public AssetObjectGarbageCollector(
            AssetObjectLifecycleService lifecycleService,
            GenerationObjectDeletionStorage storage) {
        this.lifecycleService = lifecycleService;
        this.storage = storage;
    }

    public boolean runOnce(String workerId) {
        if (lifecycleService.recoverOneExpiredTransfer()) {
            return true;
        }
        AssetObjectDeletionClaim claim = lifecycleService.claimDeletion(workerId);
        if (claim == null) {
            return false;
        }
        try {
            storage.delete(claim.storageKey());
        } catch (RuntimeException exception) {
            lifecycleService.releaseDeletion(claim);
            throw exception;
        }
        lifecycleService.completeDeletion(claim);
        return true;
    }
}
