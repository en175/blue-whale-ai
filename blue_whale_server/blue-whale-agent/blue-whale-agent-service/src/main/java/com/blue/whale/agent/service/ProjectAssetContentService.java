package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
@RequiredArgsConstructor
public class ProjectAssetContentService {

    private final ProjectService projectService;
    private final AssetMapper assetMapper;
    private final ObjectProvider<GenerationObjectReader> readerProvider;

    public AssetContent read(Long projectId, Long assetId, Long userId) {
        projectService.requireOwned(projectId, userId);
        Asset asset = assetMapper.selectById(assetId);
        if (asset == null || !Objects.equals(asset.getProjectId(), projectId)
                || !Asset.STATUS_NORMAL.equals(asset.getStatus())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        GenerationObjectReader reader = readerProvider.getIfAvailable();
        byte[] content = reader == null ? null : reader.read(asset.getStorageKey());
        if (content == null) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源不可用");
        }
        return new AssetContent(content, asset.getMime());
    }
}
