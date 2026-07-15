package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.generation.GenerationObjectSigner;
import com.blue.whale.agent.service.generation.SignedGenerationObject;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
@RequiredArgsConstructor
public class ProjectAssetAccessService {

    private final ProjectService projectService;
    private final AssetMapper assetMapper;
    private final ObjectProvider<GenerationObjectSigner> signerProvider;

    public SignedGenerationObject sign(Long projectId, Long assetId, Long userId) {
        projectService.requireOwned(projectId, userId);
        Asset asset = assetMapper.selectById(assetId);
        if (asset == null || !Objects.equals(asset.getProjectId(), projectId)
                || !Objects.equals(asset.getUserId(), userId)
                || !Asset.STATUS_NORMAL.equals(asset.getStatus())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        if (asset.getStorageKey() == null || asset.getStorageKey().isBlank()) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源不可用");
        }
        GenerationObjectSigner signer = signerProvider.getIfAvailable();
        if (signer == null) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源不可用");
        }
        try {
            return signer.sign(asset.getStorageKey());
        } catch (RuntimeException exception) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源不可用");
        }
    }
}
