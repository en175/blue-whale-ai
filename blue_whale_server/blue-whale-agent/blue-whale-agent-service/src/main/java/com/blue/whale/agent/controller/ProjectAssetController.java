package com.blue.whale.agent.controller;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.agent.model.dto.AssetAccessResponse;
import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.agent.service.generation.SignedGenerationObject;
import com.blue.whale.global.base.resp.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects/{projectId}/assets")
@RequiredArgsConstructor
public class ProjectAssetController {

    private final ProjectAssetContentService assetContentService;
    private final ProjectAssetAccessService assetAccessService;

    @GetMapping("/{assetId}")
    public Result<AssetAccessResponse> access(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long projectId,
            @PathVariable Long assetId) {
        SignedGenerationObject signed = assetAccessService.sign(
                projectId, assetId, UserContext.requireUserId(userId));
        return Result.ok(new AssetAccessResponse(signed.url(), signed.expiresAt()));
    }

    @GetMapping("/{assetId}/content")
    public ResponseEntity<byte[]> content(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long projectId,
            @PathVariable Long assetId) {
        AssetContent content = assetContentService.read(
                projectId, assetId, UserContext.requireUserId(userId));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(content.mimeType()))
                .contentLength(content.content().length)
                .body(content.content());
    }
}
