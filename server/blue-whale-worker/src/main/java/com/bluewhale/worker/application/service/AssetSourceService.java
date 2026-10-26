package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class AssetSourceService {

    private final AssetMapper assetMapper;

    public AssetSourceService(AssetMapper assetMapper) {
        this.assetMapper = assetMapper;
    }

    public AssetEntity resolve(Long assetId, Long userId, Long projectId) {
        var linkedIds = assetMapper.findLinkedAssetIds(userId, projectId);
        AssetEntity row = assetMapper.resolveSourceAssetWithLinked(assetId, userId, projectId, linkedIds);
        if (row == null || row.getStorageKey() == null) {
            return null;
        }
        return row;
    }

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

        Map<String, AssetEntity> byId = new LinkedHashMap<>();
        for (AssetEntity row : rows) {
            byId.put(row.getId().toString(), row);
        }
        return byId;
    }
}
