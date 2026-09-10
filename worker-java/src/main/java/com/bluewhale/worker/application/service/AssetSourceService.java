package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import org.springframework.stereotype.Service;

/**
 * media_extract 源视频资产解析——WorkerRepo.resolveMediaExtractSource 的 Java 对位
 * （generation-worker-asset-ops.ts:81-101，IKARDY/IKDD4Z）。
 * <p>
 * 归属三分支（本项目 ∪ project_id=0 全局 ∪ project_asset 显式关联）+
 * status='normal' + is_delete=false；
 * <b>storage_key 为 null 的行一律视为不可用</b>（TS :99 `!row.storage_key → null`——
 * passthrough 降级的资产没有可下载的自有存储，extract 必须硬失败而不是去拉上游过期签名 URL）。
 */
@Service
public class AssetSourceService {

    private final AssetMapper assetMapper;

    public AssetSourceService(AssetMapper assetMapper) {
        this.assetMapper = assetMapper;
    }

    /** @return 源资产（storage_key 非空）；null = source_asset_unavailable。 */
    public AssetEntity resolve(Long assetId, Long userId, Long projectId) {
        var linkedIds = assetMapper.findLinkedAssetIds(userId, projectId);
        AssetEntity row = assetMapper.resolveSourceAssetWithLinked(assetId, userId, projectId, linkedIds);
        if (row == null || row.getStorageKey() == null) {
            return null;
        }
        return row;
    }
}
