package com.blue.whale.agent.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import com.blue.whale.agent.model.dto.AssetDto;
import com.blue.whale.agent.model.dto.AssetResponse;
import com.blue.whale.agent.model.dto.CommitUploadRequest;
import com.blue.whale.agent.model.dto.UploadAssetResponse;
import com.blue.whale.agent.service.AssetService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 资源接口：资产库分页查询（{@code GET /assets}）+ 素材上传（中转 {@code POST /assets/upload}
 * + 前端直传落库 {@code POST /assets/upload/commit}，IK3PKB）+ 按 id 取资产（{@code GET /assets/{id}}）。
 *
 * <p>用户身份走 {@code X-User-Id} 请求头，与 {@code GenerationController} 一致。
 * 前端直传的预签名由 Next.js API route 签发（持 AK/SK），后端只负责 commit 落库校验。</p>
 */
@Tag(name = "资源接口", description = "资产库分页 / 素材上传（中转+直传落库）/ 资产详情")
@RestController
@RequestMapping("/api/agent/assets")
@RequiredArgsConstructor
public class AssetController {

    private final AssetService assetService;

    /** 按 user + type 分页查资产，按创建时间倒序。 */
    @GetMapping
    public Result<Page<AssetDto>> listAssets(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam(name = "projectId", required = false) Long projectId,
            @RequestParam(name = "type", required = false) String type,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "size", defaultValue = "24") int size) {
        return Result.ok(assetService.listAssets(requireUserId(userId), projectId, type, page, size));
    }

    /** 上传素材中转 TOS（旧链路，保留兼容）：multipart 文件 + projectId + type → {id, url}。 */
    @PostMapping("/upload")
    public Result<UploadAssetResponse> upload(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam("projectId") Long projectId,
            @RequestParam("type") String type,
            @RequestParam("file") MultipartFile file) {
        return Result.ok(assetService.uploadAsset(requireUserId(userId), projectId, file, type));
    }

    /**
     * 前端直传 commit（IK3PKB）：前端分片直传 TOS 完成后落 Asset。
     * HEAD object 校验存在/size/MIME，同 storageKey 幂等。
     */
    @PostMapping("/upload/commit")
    public Result<UploadAssetResponse> commitUpload(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody CommitUploadRequest req) {
        return Result.ok(assetService.commitUpload(requireUserId(userId), req));
    }

    /** 按 id 取资产详情（归属校验）。 */
    @GetMapping("/{id}")
    public Result<AssetResponse> getAsset(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("id") Long id) {
        return Result.ok(assetService.getAsset(requireUserId(userId), id));
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
