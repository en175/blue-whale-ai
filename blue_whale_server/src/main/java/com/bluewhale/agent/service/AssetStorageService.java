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
import java.net.URLConnection;
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
 *
 * <p>MIME 优先按调用方传入值，其次按 HTTP {@code Content-Type}，再按 URL 扩展名推导，避免把 JPEG 等强制存为 PNG。
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
        Path dir = Paths.get(storageDir);
        try {
            Files.createDirectories(dir);
            URI uri = URI.create(sourceUrl);
            URLConnection conn = uri.toURL().openConnection();
            String detectedMime = detectMime(mime, conn, uri);
            String filename = type + "-" + UUID.randomUUID() + extension(detectedMime);
            Path target = dir.resolve(filename);
            try (InputStream in = conn.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            long size = Files.size(target);
            Asset asset = new Asset()
                    .setUserId(userId)
                    .setType(type)
                    .setStorageKey(filename)
                    .setUrl(urlPrefix + "/" + filename)
                    .setMime(detectedMime)
                    .setSize(size)
                    .setSource(Asset.SOURCE_GENERATED)
                    .setStatus(Asset.STATUS_NORMAL);
            assetMapper.insert(asset);
            log.info("asset stored: id={}, type={}, mime={}, size={}, url={}",
                    asset.getId(), type, detectedMime, size, asset.getUrl());
            return asset;
        } catch (Exception e) {
            log.error("download asset failed: {}", sourceUrl, e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源下载转存失败: " + e.getMessage());
        }
    }

    private String detectMime(String explicitMime, URLConnection conn, URI uri) {
        if (explicitMime != null && !explicitMime.isBlank()) {
            return normalizeMime(explicitMime);
        }
        String contentType = conn.getContentType();
        if (contentType != null && !contentType.isBlank()) {
            return normalizeMime(contentType);
        }
        String path = uri.getPath();
        if (path != null) {
            String lower = path.toLowerCase();
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".webp")) return "image/webp";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".mp4")) return "video/mp4";
        }
        return "image/png";
    }

    private String normalizeMime(String mime) {
        if (mime == null) {
            return null;
        }
        // Content-Type 可能带 charset，取分号前部分并 trim
        int idx = mime.indexOf(';');
        return idx >= 0 ? mime.substring(0, idx).trim().toLowerCase() : mime.trim().toLowerCase();
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
            case "image/gif" -> ".gif";
            default -> ".bin";
        };
    }
}
