package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetDto;
import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.dto.CommitUploadRequest;
import com.blue.whale.agent.model.dto.UploadAssetResponse;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.ObjectHead;
import com.blue.whale.tool.upload.model.OssConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 资源服务：资产库分页查询 + 上传中转（{@link #uploadAsset}）+ 按 id 取资产（{@link #getAsset}）
 * + 前端直传落库（{@link #commitUpload}，IK3PKB）。
 *
 * <p>前端直传链路：Next.js 预签名（init/sign-part/complete）→ 前端分片直传 TOS →
 * {@code commitUpload} HEAD 校验后落 Asset。前端只拿预签名 URL，后端持 AK/SK 签发。</p>
 */
@Slf4j
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
    private final OssConfig ossConfig;

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
     * 上传素材中转 TOS（旧链路，保留兼容）：multipart 文件 → 服务端 putObject → 返 {id, url}。
     *
     * <p>前端切换预签名直传后此接口不再被调用，保留作为降级。</p>
     */
    public UploadAssetResponse uploadAsset(Long userId, Long projectId, MultipartFile file, String type) {
        projectService.requireOwned(projectId, userId);
        validateType(type);
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

    /**
     * 前端直传落库（IK3PKB）：校验归属/类型/大小 → 幂等（同 storageKey 已落库直接返回）
     * → HEAD object 校验存在/size/MIME → insert Asset。
     *
     * <p>前端分片直传 TOS 完成后调用，storageKey 由 Next.js prepare 生成。</p>
     */
    public UploadAssetResponse commitUpload(Long userId, CommitUploadRequest req) {
        Long projectId = req.getProjectId();
        String type = req.getType();
        String storageKey = req.getStorageKey();
        String contentType = req.getContentType();
        Long size = req.getSize();
        if (projectId == null || storageKey == null || storageKey.isBlank()) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "缺少 projectId / storageKey");
        }
        projectService.requireOwned(projectId, userId);
        validateType(type);
        if (contentType == null || !contentType.startsWith(type + "/")) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "文件类型与声明类型不匹配");
        }
        long maxSize = maxSizeOf(type);
        if (size == null || size <= 0 || size > maxSize) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                    "文件大小非法或超出限制（" + sizeLimitTip(type) + "）");
        }
        // 幂等：同 user + storageKey 已落库直接返回（防重复 commit）
        Asset exist = assetMapper.selectOne(Wrappers.<Asset>lambdaQuery()
                .eq(Asset::getUserId, userId)
                .eq(Asset::getStorageKey, storageKey)
                .last("LIMIT 1"));
        if (exist != null) {
            log.info("commit direct upload 命中幂等: userId={}, key={}, assetId={}", userId, storageKey, exist.getId());
            return new UploadAssetResponse(exist.getId(), exist.getUrl());
        }
        // HEAD object 校验：确认直传对象真实存在 + size + content-type
        ObjectHead head = assetStorageService.headObject(storageKey);
        if (!head.isExists()) {
            throw new GlobalException(SystemCode.ASSET_UNAVAILABLE_CODE, "文件未上传成功，请重传");
        }
        if (!size.equals(head.getContentLength())) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "文件大小与实际上传不符");
        }
        if (head.getContentType() == null
                || !contentType.equalsIgnoreCase(stripCharset(head.getContentType()))) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "文件类型与声明不符");
        }
        Asset asset = new Asset()
                .setUserId(userId)
                .setProjectId(projectId)
                .setType(type)
                .setStorageKey(storageKey)
                .setUrl(ossConfig.getDomain() + "/" + storageKey)
                .setMime(contentType)
                .setSize(head.getContentLength())
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL)
                .setWidth(req.getWidth())
                .setHeight(req.getHeight())
                .setDuration(req.getDuration());
        assetMapper.insert(asset);
        log.info("asset committed (direct upload): id={}, type={}, mime={}, size={}, key={}",
                asset.getId(), type, contentType, head.getContentLength(), storageKey);
        return new UploadAssetResponse(asset.getId(), asset.getUrl());
    }

    /** 校验资源类型合法（image/video/audio）。 */
    private void validateType(String type) {
        if (!Asset.TYPE_IMAGE.equals(type) && !Asset.TYPE_VIDEO.equals(type) && !Asset.TYPE_AUDIO.equals(type)) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "不支持的资源类型: " + type);
        }
    }

    /** 去除 Content-Type 的 charset 后缀（如 image/png; charset=... → image/png）。 */
    private String stripCharset(String contentType) {
        int idx = contentType.indexOf(';');
        return (idx >= 0 ? contentType.substring(0, idx) : contentType).trim().toLowerCase();
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
