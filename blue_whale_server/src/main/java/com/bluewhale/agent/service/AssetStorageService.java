package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.model.entity.Asset;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

/**
 * 资源下载转存：Ark video_url 24h 过期，succeeded 时立即下载落本地，{@code assets.url} 存转存后地址。
 *
 * <p>本地落盘 {@code ${volcengine.asset.storage-dir:./data/assets}}，通过 {@code /assets/**} 静态映射暴露。
 * 对象存储后续替换实现，接口不变。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssetStorageService {

    private final AssetMapper assetMapper;

    @Value("${volcengine.asset.storage-dir:./data/assets}")
    private String storageDir;

    @Value("${volcengine.asset.url-prefix:/assets}")
    private String urlPrefix;

    /** 下载 sourceUrl 落本地，insert asset，返回 asset。 */
    public Asset downloadAndStore(String sourceUrl, Long userId, String type, String mime) {
        String filename = type + "-" + UUID.randomUUID() + extension(mime);
        Path dir = Paths.get(storageDir);
        try {
            Files.createDirectories(dir);
            Path target = dir.resolve(filename);
            try (InputStream in = URI.create(sourceUrl).toURL().openStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            long size = Files.size(target);
            Asset asset = new Asset()
                    .setUserId(userId)
                    .setType(type)
                    .setStorageKey(filename)
                    .setUrl(urlPrefix + "/" + filename)
                    .setMime(mime)
                    .setSize(size)
                    .setSource(Asset.SOURCE_GENERATED)
                    .setStatus(Asset.STATUS_NORMAL);
            assetMapper.insert(asset);
            log.info("asset stored: id={}, type={}, size={}, url={}", asset.getId(), type, size, asset.getUrl());
            return asset;
        } catch (Exception e) {
            log.error("download asset failed: {}", sourceUrl, e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源下载转存失败: " + e.getMessage());
        }
    }

    private String extension(String mime) {
        if (mime == null) {
            return ".bin";
        }
        return switch (mime) {
            case "video/mp4" -> ".mp4";
            case "image/png" -> ".png";
            case "image/jpeg", "image/jpg" -> ".jpg";
            case "image/webp" -> ".webp";
            default -> ".bin";
        };
    }
}
