package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 素材解析服务（generation-worker-asset-ops.ts 逐字移植）。
 * <p>
 * 刀①：resolveMediaExtractSource（asset-ops.ts:81-101）——单资产 + storage_key 非空。
 * 刀②：resolveInputAssets（asset-ops.ts:30-79）——批量资产解析，音频参考与图片参考共用。
 * <p>
 * 归属三分支（IKDD4Z）：本项目直接 ∪ 全局素材(project_id=0) ∪ project_asset 显式关联。
 */
@Service
public class AssetSourceService {

    private final AssetMapper assetMapper;

    public AssetSourceService(AssetMapper assetMapper) {
        this.assetMapper = assetMapper;
    }

    /**
     * media_extract 源资产解析（asset-ops.ts:81-101）。
     *
     * @return 源资产（storage_key 非空）；null = source_asset_unavailable
     */
    public AssetEntity resolve(Long assetId, Long userId, Long projectId) {
        var linkedIds = assetMapper.findLinkedAssetIds(userId, projectId);
        AssetEntity row = assetMapper.resolveSourceAssetWithLinked(assetId, userId, projectId, linkedIds);
        if (row == null || row.getStorageKey() == null) {
            return null;
        }
        return row;
    }

    /**
     * 批量解析输入素材（asset-ops.ts:30-79 resolveInputAssets）。
     * <p>
     * 返回按输入 id 顺序排列的资产映射（TS :59-78 byId → flatMap 保序）。
     * 音频/图片参考共用；linked 分支 REQUIRED（blade-① 偏差已修，IKDD4Z）。
     *
     * @param assetIds  素材 id 列表（字符串形式，解析为 Long）
     * @param userId    用户 id
     * @param projectId 项目 id
     * @return id → AssetEntity 映射（仅命中项；缺失项不在 map 中）
     */
    public Map<String, AssetEntity> resolveInputAssets(List<String> assetIds, String userId, String projectId) {
        if (assetIds == null || assetIds.isEmpty()) {
            return Collections.emptyMap();
        }

        Long userIdLong = Long.parseLong(userId);
        Long projectIdLong = Long.parseLong(projectId);
        List<Long> linkedIds = assetMapper.findLinkedAssetIds(userIdLong, projectIdLong);

        List<Long> idsLong = assetIds.stream()
                .map(Long::parseLong)
                .toList();

        List<AssetEntity> rows = assetMapper.resolveInputAssetsWithLinked(
                idsLong, userIdLong, projectIdLong, linkedIds);

        // TS :59 byId = new Map(rows.map(row => [row.id.toString(), row]))
        // 用 LinkedHashMap 保序（与 TS Map 插入序一致）
        Map<String, AssetEntity> byId = new LinkedHashMap<>();
        for (AssetEntity row : rows) {
            byId.put(row.getId().toString(), row);
        }
        return byId;
    }
}
