package com.blue.whale.agent.model.dto;

/**
 * 上传素材响应（{@code POST /assets/upload}）。
 *
 * @param id  资产 id
 * @param url TOS 可访问 url
 */
public record UploadAssetResponse(Long id, String url) {
}
