package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.constraints.NotNull;

/**
 * Asset 跨项目复制请求（「添加到项目」）。
 *
 * @param sourceAssetId 源 Asset ID（必须归属当前用户且状态 normal）
 */
public record CopyAssetRequest(@JsonProperty("source_asset_id") @NotNull Long sourceAssetId) {
}
