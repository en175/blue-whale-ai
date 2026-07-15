package com.blue.whale.agent.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import com.blue.whale.agent.model.dto.AssetDto;
import com.blue.whale.agent.service.AssetService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 资源接口：资产库分页查询（资产页 {@code /assets}）。
 *
 * <p>用户身份走 {@code X-User-Id} 请求头（MVP 无鉴权，前端直传），与 {@code GenerationController} 一致。
 */
@Tag(name = "资源接口", description = "资产库分页查询")
@RestController
@RequestMapping("/api/agent/assets")
@RequiredArgsConstructor
public class AssetController {

    private final AssetService assetService;

    /** 按 user + type 分页查资产，按创建时间倒序。 */
    @GetMapping
    public Result<Page<AssetDto>> listAssets(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam(name = "type", required = false) String type,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "size", defaultValue = "24") int size) {
        return Result.ok(assetService.listAssets(requireUserId(userId), type, page, size));
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
