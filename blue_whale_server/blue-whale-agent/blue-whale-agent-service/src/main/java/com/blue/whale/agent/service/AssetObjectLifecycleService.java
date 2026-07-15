package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssetObjectTransferMapper;
import com.blue.whale.agent.mapper.AssetStorageObjectMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.dto.AssetObjectDeletionClaim;
import com.blue.whale.agent.model.dto.AssetObjectTransferHandle;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.AssetObjectTransfer;
import com.blue.whale.agent.model.entity.AssetStorageObject;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AssetObjectLifecycleService {

    static final long UNREFERENCED_RETENTION_DAYS = 7;
    private static final long TRANSFER_LEASE_HOURS = 1;
    private static final long DELETE_LEASE_MINUTES = 5;

    private final AssetStorageObjectMapper objectMapper;
    private final AssetObjectTransferMapper transferMapper;
    private final AssetMapper assetMapper;
    private final GenerationJobMapper jobMapper;

    @Transactional
    public AssetObjectTransferHandle beginTransfer(String storageKey, String source) {
        requireIdentity(storageKey, source);
        LocalDateTime now = jobMapper.selectCurrentTime();
        AssetStorageObject object = objectMapper.selectByStorageKeyForUpdate(storageKey);
        if (object == null) {
            objectMapper.insertAvailableIfAbsent(storageKey, source);
            object = objectMapper.selectByStorageKeyForUpdate(storageKey);
        }
        if (object == null
                || !Objects.equals(object.getSource(), source)
                || !AssetStorageObject.STATE_AVAILABLE.equals(object.getState())) {
            throw lifecycleConflict();
        }
        object.setActiveTransferCount(object.getActiveTransferCount() + 1)
                .setFirstUnreferencedAt(null);
        updateObject(object);
        AssetObjectTransfer transfer = new AssetObjectTransfer()
                .setTransferToken(UUID.randomUUID().toString())
                .setStorageKey(storageKey)
                .setStatus(AssetObjectTransfer.STATUS_ACTIVE)
                .setExpiresAt(now.plusHours(TRANSFER_LEASE_HOURS));
        transferMapper.insert(transfer);
        return new AssetObjectTransferHandle(transfer.getTransferToken(), storageKey);
    }

    @Transactional
    public void completeTransfer(AssetObjectTransferHandle handle, String contentSha256) {
        if (contentSha256 == null || !contentSha256.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Asset 对象摘要无效");
        }
        settleTransfer(handle, AssetObjectTransfer.STATUS_COMPLETED, contentSha256);
    }

    @Transactional
    public void failTransfer(AssetObjectTransferHandle handle) {
        settleTransfer(handle, AssetObjectTransfer.STATUS_FAILED, null);
    }

    @Transactional
    public void protectReference(String storageKey, String contentSha256, String source) {
        requireIdentity(storageKey, source);
        AssetStorageObject object = objectMapper.selectByStorageKeyForUpdate(storageKey);
        if (object == null) {
            object = new AssetStorageObject()
                    .setStorageKey(storageKey)
                    .setContentSha256(contentSha256)
                    .setSource(source)
                    .setState(AssetStorageObject.STATE_AVAILABLE)
                    .setActiveTransferCount(0);
            objectMapper.insert(object);
            return;
        }
        if (!Objects.equals(object.getSource(), source)
                || !AssetStorageObject.STATE_AVAILABLE.equals(object.getState())
                || (object.getContentSha256() != null
                && contentSha256 != null
                && !Objects.equals(object.getContentSha256(), contentSha256))) {
            throw lifecycleConflict();
        }
        if (object.getContentSha256() == null) {
            object.setContentSha256(contentSha256);
        }
        object.setFirstUnreferencedAt(null);
        updateObject(object);
    }

    @Transactional
    public boolean recoverOneExpiredTransfer() {
        LocalDateTime now = jobMapper.selectCurrentTime();
        AssetObjectTransfer transfer = transferMapper.selectExpiredForUpdate(now);
        if (transfer == null) {
            return false;
        }
        settleLockedTransfer(transfer, AssetObjectTransfer.STATUS_EXPIRED, null, now);
        return true;
    }

    @Transactional
    public AssetObjectDeletionClaim claimDeletion(String owner) {
        if (owner == null || owner.isBlank() || owner.length() > 128) {
            throw new IllegalArgumentException("Asset GC Worker 标识无效");
        }
        LocalDateTime now = jobMapper.selectCurrentTime();
        AssetStorageObject object = objectMapper.selectGcCandidateForUpdate(
                now.minusDays(UNREFERENCED_RETENTION_DAYS), now);
        if (object == null) {
            return null;
        }
        if (object.getActiveTransferCount() != 0
                || assetMapper.countAllByStorageKey(object.getStorageKey()) != 0) {
            object.setFirstUnreferencedAt(null)
                    .setState(AssetStorageObject.STATE_AVAILABLE)
                    .setDeleteOwner(null)
                    .setDeleteLeaseExpiresAt(null);
            updateObject(object);
            return null;
        }
        object.setState(AssetStorageObject.STATE_DELETING)
                .setDeleteOwner(owner)
                .setDeleteLeaseExpiresAt(now.plusMinutes(DELETE_LEASE_MINUTES));
        updateObject(object);
        return new AssetObjectDeletionClaim(object.getId(), object.getStorageKey(), owner);
    }

    @Transactional
    public void completeDeletion(AssetObjectDeletionClaim claim) {
        AssetStorageObject object = requireDeletionClaim(claim);
        if (object.getActiveTransferCount() != 0
                || assetMapper.countAllByStorageKey(object.getStorageKey()) != 0) {
            throw lifecycleConflict();
        }
        object.setState(AssetStorageObject.STATE_DELETED)
                .setDeleteOwner(null)
                .setDeleteLeaseExpiresAt(null);
        updateObject(object);
    }

    @Transactional
    public void releaseDeletion(AssetObjectDeletionClaim claim) {
        AssetStorageObject object = requireDeletionClaim(claim);
        object.setState(AssetStorageObject.STATE_AVAILABLE)
                .setDeleteOwner(null)
                .setDeleteLeaseExpiresAt(null);
        updateObject(object);
    }

    private void settleTransfer(
            AssetObjectTransferHandle handle,
            String status,
            String contentSha256) {
        if (handle == null || handle.token() == null || handle.storageKey() == null) {
            throw new IllegalArgumentException("Asset 对象传输句柄无效");
        }
        AssetObjectTransfer transfer = transferMapper.selectByTokenForUpdate(handle.token());
        if (transfer == null || !Objects.equals(transfer.getStorageKey(), handle.storageKey())) {
            throw lifecycleConflict();
        }
        if (!AssetObjectTransfer.STATUS_ACTIVE.equals(transfer.getStatus())) {
            return;
        }
        settleLockedTransfer(transfer, status, contentSha256, jobMapper.selectCurrentTime());
    }

    private void settleLockedTransfer(
            AssetObjectTransfer transfer,
            String status,
            String contentSha256,
            LocalDateTime now) {
        AssetStorageObject object = objectMapper.selectByStorageKeyForUpdate(transfer.getStorageKey());
        if (object == null || !AssetStorageObject.STATE_AVAILABLE.equals(object.getState())
                || object.getActiveTransferCount() == null || object.getActiveTransferCount() < 1
                || (contentSha256 != null && object.getContentSha256() != null
                && !Objects.equals(contentSha256, object.getContentSha256()))) {
            throw lifecycleConflict();
        }
        transfer.setStatus(status);
        if (transferMapper.updateById(transfer) != 1) {
            throw lifecycleConflict();
        }
        int remaining = object.getActiveTransferCount() - 1;
        object.setActiveTransferCount(remaining);
        if (contentSha256 != null) {
            object.setContentSha256(contentSha256);
        }
        if (remaining == 0 && assetMapper.countAllByStorageKey(object.getStorageKey()) == 0) {
            object.setFirstUnreferencedAt(now);
        }
        updateObject(object);
    }

    private AssetStorageObject requireDeletionClaim(AssetObjectDeletionClaim claim) {
        if (claim == null || claim.objectId() == null || claim.storageKey() == null
                || claim.owner() == null) {
            throw new IllegalArgumentException("Asset 对象删除认领无效");
        }
        AssetStorageObject object = objectMapper.selectByStorageKeyForUpdate(claim.storageKey());
        if (object == null || !Objects.equals(object.getId(), claim.objectId())
                || !AssetStorageObject.STATE_DELETING.equals(object.getState())
                || !Objects.equals(object.getDeleteOwner(), claim.owner())) {
            throw lifecycleConflict();
        }
        return object;
    }

    private void requireIdentity(String storageKey, String source) {
        if (storageKey == null || storageKey.isBlank() || storageKey.length() > 512
                || (!Asset.SOURCE_GENERATED.equals(source) && !Asset.SOURCE_UPLOADED.equals(source))) {
            throw new IllegalArgumentException("Asset 对象身份无效");
        }
    }

    private void updateObject(AssetStorageObject object) {
        if (objectMapper.updateById(object) != 1) {
            throw lifecycleConflict();
        }
    }

    private GlobalException lifecycleConflict() {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, "Asset 对象生命周期已变化");
    }
}
