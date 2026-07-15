package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetDto;
import com.blue.whale.agent.model.entity.Asset;
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
    public Page<AssetDto> listAssets(Long userId, String type, int page, int size) {
       IPage<Asset> assetPage = assetMapper.selectPage(new Page<>(page, size),
                Wrappers.<Asset>lambdaQuery()
                        .eq(Asset::getUserId, userId)
                        .eq(type != null && !type.isBlank(), Asset::getType, type)
                        .orderByDesc(Asset::getGmtCreate));
        Page<AssetDto> result = new Page<>(assetPage.getCurrent(), assetPage.getSize(), assetPage.getTotal());
        result.setRecords(assetPage.getRecords().stream()
                .map(a -> new AssetDto(a.getId(), a.getType(), a.getUrl(), a.getWidth(), a.getHeight(),
                        a.getDuration(), a.getSource(), a.getGmtCreate()))
                .toList());
        return result;
    }
}
