package com.bluewhale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.model.dto.AssetResponse;
import com.bluewhale.agent.model.entity.Asset;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 资源服务：资产库分页查询，复用 MyBatis-Plus {@link Page}。
 */
@Service
@RequiredArgsConstructor
public class AssetService {

    private final AssetMapper assetMapper;

    /** 按 {@code userId} + {@code type} 分页查资产，按创建时间倒序。 */
    public Page<AssetResponse> listAssets(Long userId, String type, int page, int size) {
        Page<Asset> assetPage = assetMapper.selectPage(new Page<>(page, size),
                Wrappers.<Asset>lambdaQuery()
                        .eq(Asset::getUserId, userId)
                        .eq(type != null && !type.isBlank(), Asset::getType, type)
                        .orderByDesc(Asset::getGmtCreate));
        Page<AssetResponse> result = new Page<>(assetPage.getCurrent(), assetPage.getSize(), assetPage.getTotal());
        result.setRecords(assetPage.getRecords().stream()
                .map(a -> new AssetResponse(a.getId(), a.getType(), a.getUrl(), a.getWidth(), a.getHeight(),
                        a.getDuration(), a.getSource(), a.getGmtCreate()))
                .toList());
        return result;
    }
}
