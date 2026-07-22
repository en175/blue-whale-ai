package com.blue.whale.agent.model.dto;

/**
 * read_asset 工具响应（IK2QC7）：Agent 读取单个 Asset 的紧凑元数据。
 *
 * 与资产库页 {@link AssetResponse} 区分：本视图面向 Agent 工具，含 {@code status}（判断可用性）、
 * {@code mime} 与 {@code size}，不含 {@code createdAt}。仅放行选中 / @ 引用范围内的 Asset
 * （画布节点 assetId ∪ 本 Run 的 GenerationJob 输出），叠加 projectId + userId + status=normal 三元组。
 * url 为可访问地址，size 单位字节，duration 仅视频有（秒）。
 */
public record AgentAssetResponse(
        Long assetId,
        String type,
        String source,
        String status,
        String mime,
        Long size,
        Integer width,
        Integer height,
        Integer duration,
        String url
) {}
