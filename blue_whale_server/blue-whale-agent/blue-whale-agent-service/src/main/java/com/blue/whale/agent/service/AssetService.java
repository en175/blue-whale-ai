package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetDto;
import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.dto.UploadAssetResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 资源服务：资产库分页查询 + 上传中转（{@link #uploadAsset}）+ 按 id 取资产（{@link #getAsset}）。
 *
 * <p>上传归属校验复用 {@link ProjectService#requireOwned}，转存走 {@link AssetStorageService#storeUploaded}（TOS）。
 */
@Service
@RequiredArgsConstructor
public class AssetService {

    /** 图片大小上限 2MB。 */
    private static final long MAX_IMAGE_SIZE = 2 * 1024 * 1024L;
    /** 视频大小上限 50MB。 */
    private static final long MAX_VIDEO_SIZE = 50 * 1024 * 1024L;
    /** 音频大小上限 25MB。 */
    private static final long MAX_AUDIO_SIZE = 25 * 1024 * 1024L;

    private final AssetMapper assetMapper;
    private final AssetStorageService assetStorageService;
    private final ProjectService projectService;

    /** 按 {@code userId}（+ 可选 {@code projectId} / {@code type}）分页查资产，按创建时间倒序。 */
    public Page<AssetDto> listAssets(Long userId, Long projectId, String type, int page, int size) {
       IPage<Asset> assetPage = assetMapper.selectPage(new Page<>(page, size),
                Wrappers.<Asset>lambdaQuery()
                        .eq(Asset::getUserId, userId)
                        .eq(projectId != null, Asset::getProjectId, projectId)
                        .eq(type != null && !type.isBlank(), Asset::getType, type)
                        .orderByDesc(Asset::getGmtCreate));
        Page<AssetDto> result = new Page<>(assetPage.getCurrent(), assetPage.getSize(), assetPage.getTotal());
        result.setRecords(assetPage.getRecords().stream()
                .map(a -> new AssetDto(a.getId(), a.getType(), a.getUrl(), a.getWidth(), a.getHeight(),
                        a.getDuration(), a.getSource(), a.getGmtCreate()))
                .toList());
        return result;
    }

    /**
     * 上传素材中转 TOS：归属校验 → 类型/MIME/大小校验 → 转存 → 返 {id, url}。
     *
     * @param userId    操作用户（X-User-Id）
     * @param projectId 所属项目（必须为该用户拥有）
     * @param file      上传文件
     * @param type      资源类型 image / video / audio
     */
    public UploadAssetResponse uploadAsset(Long userId, Long projectId, MultipartFile file, String type) {
        projectService.requireOwned(projectId, userId);
        if (!Asset.TYPE_IMAGE.equals(type) && !Asset.TYPE_VIDEO.equals(type) && !Asset.TYPE_AUDIO.equals(type)) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "不支持的资源类型: " + type);
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith(type + "/")) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "文件类型与声明类型不匹配");
        }
        long maxSize = maxSizeOf(type);
        if (file.getSize() > maxSize) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                    "文件超出大小限制（" + sizeLimitTip(type) + "）");
        }
        Asset asset = assetStorageService.storeUploaded(file, userId, projectId, type);
        return new UploadAssetResponse(asset.getId(), asset.getUrl());
    }

    /** 按资源类型取大小上限（image/video/audio）。 */
    private long maxSizeOf(String type) {
        if (Asset.TYPE_IMAGE.equals(type)) return MAX_IMAGE_SIZE;
        if (Asset.TYPE_VIDEO.equals(type)) return MAX_VIDEO_SIZE;
        return MAX_AUDIO_SIZE;
    }

    /** 按资源类型取大小上限提示文案。 */
    private String sizeLimitTip(String type) {
        if (Asset.TYPE_IMAGE.equals(type)) return "图片≤2MB";
        if (Asset.TYPE_VIDEO.equals(type)) return "视频≤50MB";
        return "音频≤25MB";
    }

    /** 按 id 取资产（归属校验：仅owner可取）。 */
    public AssetResponse getAsset(Long userId, Long assetId) {
        Asset asset = assetMapper.selectById(assetId);
        if (asset == null) {
            throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "资产不存在");
        }
        if (!userId.equals(asset.getUserId())) {
            throw new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限访问该资产");
        }
        return new AssetResponse(asset.getId(), asset.getProjectId(), asset.getType(), asset.getUrl(),
                asset.getWidth(), asset.getHeight(), asset.getDuration(), asset.getSource(), asset.getGmtCreate());
    }
}
