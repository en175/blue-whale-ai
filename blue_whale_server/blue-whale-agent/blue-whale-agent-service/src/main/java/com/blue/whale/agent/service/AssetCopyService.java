package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Asset 跨项目复制（「添加到项目」）：在目标 canvas 项目落一行新的 Asset 副本，
 * 与源行共享同一物理存储对象（{@code storageKey}），副本行级独立（源行删除不影响副本）。
 *
 * <p>目标项目必须是当前用户拥有的 canvas 项目（生成收件箱不作为复制目标）；
 * 源 Asset 不存在 / 非本人 / 非正常状态统一抛 404，不泄漏资源存在性。
 * 共享存储对象经 {@link AssetObjectLifecycleService#protectReference} 防 GC。
 * 幂等（ADR-0016 §1 / ADR-0017 §4）：{@code Idempotency-Key} 必传，命名空间
 * (project_id=目标项目, operation=asset.copy, key)，摘要为 sourceAssetId；
 * 同键同源重放按 resourceId 加载首次副本返回，同键不同源 409。
 */
@Service
@RequiredArgsConstructor
public class AssetCopyService {

    private static final String OPERATION = "asset.copy";

    private final ProjectService projectService;
    private final AssetMapper assetMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final AssetObjectLifecycleService assetObjectLifecycleService;
    private final ProjectEventService projectEventService;

    /** 把 {@code sourceAssetId} 复制到目标项目，返回副本（与 AssetService.listAssets 同构造）。 */
    @Transactional
    public AssetResponse copyToProject(Long projectId, Long sourceAssetId, Long userId, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new GlobalException(100000, "缺少 Idempotency-Key");
        }
        Project target = projectService.requireOwned(projectId, userId);
        if (!Project.PURPOSE_CANVAS.equals(target.getPurpose())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        String requestHash = Sha256.hex(String.valueOf(sourceAssetId));
        CommandIdempotency existing = idempotencyMapper.selectOne(
                Wrappers.<CommandIdempotency>lambdaQuery()
                        .eq(CommandIdempotency::getProjectId, projectId)
                        .eq(CommandIdempotency::getOperation, OPERATION)
                        .eq(CommandIdempotency::getIdempotencyKey, idempotencyKey));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            Asset replayed = assetMapper.selectById(existing.getResourceId());
            if (replayed == null) {
                throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
            }
            return toResponse(replayed);
        }
        Asset source = assetMapper.selectById(sourceAssetId);
        if (source == null || !Objects.equals(source.getUserId(), userId)
                || !Asset.STATUS_NORMAL.equals(source.getStatus())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }

        Asset copy = new Asset()
                .setProjectId(projectId)
                .setUserId(userId)
                .setGenerationJobId(null)
                .setType(source.getType())
                .setStorageKey(source.getStorageKey())
                .setContentSha256(source.getContentSha256())
                .setUrl(source.getUrl())
                .setMime(source.getMime())
                .setWidth(source.getWidth())
                .setHeight(source.getHeight())
                .setDuration(source.getDuration())
                .setSize(source.getSize())
                .setSource(source.getSource())
                .setStatus(Asset.STATUS_NORMAL)
                .setSourceAssetId(source.getId());
        assetMapper.insert(copy);

        if (copy.getStorageKey() != null && !copy.getStorageKey().isBlank()) {
            assetObjectLifecycleService.protectReference(
                    copy.getStorageKey(), copy.getContentSha256(), copy.getSource());
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("asset_id", copy.getId());
        payload.put("source_asset_id", source.getId());
        payload.put("type", copy.getType());
        projectEventService.appendEvent(projectId, EventType.ASSET_CREATED,
                AggregateType.ASSET, String.valueOf(copy.getId()), copy.getVersion(),
                payload, null, null);

        idempotencyMapper.insert(new CommandIdempotency()
                .setProjectId(projectId)
                .setOperation(OPERATION)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setResourceId(copy.getId())
                .setAcceptedCursor(projectEventService.highWatermark(projectId)));
        return toResponse(copy);
    }

    private AssetResponse toResponse(Asset asset) {
        return new AssetResponse(asset.getId(), asset.getType(), asset.getUrl(), asset.getWidth(),
                asset.getHeight(), asset.getDuration(), asset.getSource(), asset.getGmtCreate());
    }
}
