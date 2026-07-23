package com.blue.whale.agent.service;


import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.util.UUID;

/**
 * 资源下载转存 + 上传中转：统一走 TOS 对象存储（{@link AbstractStorageService}）。
 *
 * <p>生成结果（{@link #downloadAndStore}）与上传素材（{@link #storeUploaded}）都转存到 TOS，
 * path = {@code assets/{projectId}/{type}/{uuid}.{ext}}（{@code ossConfig.prefix} 存在时加前缀）。
 * 对象存储未配置（无凭证、{@code storageService=null}）时 fail loud（{@code ASSET_UNAVAILABLE_CODE}）。
 *
 * <p>MIME 优先按调用方传入值，其次按 URL 扩展名推导（不发网络请求，避免下载阶段额外联网）。
 */
@Slf4j
@Service
public class AssetStorageService {

    private final AssetMapper assetMapper;
    private final AbstractStorageService storageService;
    private final OssConfig ossConfig;

    public AssetStorageService(AssetMapper assetMapper,
                               @Autowired(required = false) AbstractStorageService storageService,
                               @Autowired(required = false) OssConfig ossConfig) {
        this.assetMapper = assetMapper;
        this.storageService = storageService;
        this.ossConfig = ossConfig;
    }

    /** 下载 sourceUrl 转存 TOS，insert asset（source=generated），返回 asset。 */
    public Asset downloadAndStore(String sourceUrl, Long userId, Long projectId, String type, String mime) {
        if (storageService == null) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "对象存储未配置，无法转存资源");
        }
        if (projectId == null) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "projectId 必填");
        }
        try {
            byte[] data = download(sourceUrl);
            String detectedMime = detectMime(mime, sourceUrl);
            String path = buildPath(projectId, type, detectedMime);
            String url = storageService.upload(data, path);
            Asset asset = new Asset()
                    .setUserId(userId)
                    .setProjectId(projectId)
                    .setType(type)
                    .setStorageKey(path)
                    .setUrl(url)
                    .setMime(detectedMime)
                    .setSize((long) data.length)
                    .setSource(Asset.SOURCE_GENERATED)
                    .setStatus(Asset.STATUS_NORMAL);
            assetMapper.insert(asset);
            log.info("asset stored: id={}, type={}, mime={}, size={}, url={}",
                    asset.getId(), type, detectedMime, data.length, url);
            return asset;
        } catch (GlobalException e) {
            throw e;
        } catch (Exception e) {
            log.error("download asset failed: {}", sourceUrl, e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "资源下载转存失败: " + e.getMessage());
        }
    }

    /** 上传素材转存 TOS（source=uploaded），返回 asset。 */
    public Asset storeUploaded(MultipartFile file, Long userId, Long projectId, String type) {
        if (storageService == null) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "对象存储未配置，无法上传资源");
        }
        try {
            String mime = file.getContentType();
            byte[] data = file.getBytes();
            String path = buildPath(projectId, type, mime);
            String url = storageService.upload(data, path);
            Asset asset = new Asset()
                    .setUserId(userId)
                    .setProjectId(projectId)
                    .setType(type)
                    .setStorageKey(path)
                    .setUrl(url)
                    .setMime(mime)
                    .setSize((long) data.length)
                    .setSource(Asset.SOURCE_UPLOADED)
                    .setStatus(Asset.STATUS_NORMAL);
            assetMapper.insert(asset);
            log.info("asset uploaded: id={}, type={}, mime={}, size={}, url={}",
                    asset.getId(), type, mime, data.length, url);
            return asset;
        } catch (GlobalException e) {
            throw e;
        } catch (IOException e) {
            log.error("read uploaded file failed", e);
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "读取上传文件失败: " + e.getMessage());
        }
    }

    /** 下载 url 字节。主实现发网络请求；单测 override 返回假字节避免联网。 */
    protected byte[] download(String sourceUrl) {
        try {
            URI uri = URI.create(sourceUrl);
            try (InputStream in = uri.toURL().openStream()) {
                return in.readAllBytes();
            }
        } catch (Exception e) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "下载资源失败: " + e.getMessage());
        }
    }

    /** MIME：explicit > URL 后缀推导，不发网络。 */
    private String detectMime(String explicitMime, String sourceUrl) {
        if (explicitMime != null && !explicitMime.isBlank()) {
            return normalizeMime(explicitMime);
        }
        if (sourceUrl != null) {
            String lower = sourceUrl.toLowerCase();
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".webp")) return "image/webp";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".mp4")) return "video/mp4";
            if (lower.endsWith(".mp3")) return "audio/mpeg";
            if (lower.endsWith(".wav")) return "audio/wav";
            if (lower.endsWith(".m4a")) return "audio/mp4";
            if (lower.endsWith(".ogg")) return "audio/ogg";
            if (lower.endsWith(".aac")) return "audio/aac";
            if (lower.endsWith(".flac")) return "audio/flac";
        }
        return "image/png";
    }

    /** path = {prefix?}/assets/{projectId}/{type}/{uuid}.{ext} */
    private String buildPath(Long projectId, String type, String mime) {
        String prefix = "";
        if (ossConfig != null && ossConfig.getPrefix() != null && !ossConfig.getPrefix().isBlank()) {
            prefix = ossConfig.getPrefix() + "/";
        }
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return prefix + "assets/" + projectId + "/" + type + "/" + uuid + extension(mime);
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
            case "audio/mpeg", "audio/mp3" -> ".mp3";
            case "audio/wav", "audio/wave", "audio/x-wav" -> ".wav";
            case "audio/mp4", "audio/m4a" -> ".m4a";
            case "audio/ogg", "audio/ogg; codecs=opus" -> ".ogg";
            case "audio/aac" -> ".aac";
            case "audio/flac" -> ".flac";
            default -> ".bin";
        };
    }
}
