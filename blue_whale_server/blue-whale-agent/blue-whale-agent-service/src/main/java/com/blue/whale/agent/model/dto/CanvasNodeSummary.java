package com.blue.whale.agent.model.dto;

/**
 * 画布节点紧凑视图（IK2QC7 list_canvas_nodes）。
 *
 * 从 {@code Canvas.nodesJson} 的 React Flow 节点提取定位关键三字段：nodeId 为前端节点 id，
 * type 为节点类型，assetId 为 {@code data.assetId} 引用的 Asset（无则 null）。完整节点 data
 * 由 {@link CanvasNodeDetail} 承载，列表只给紧凑摘要控制 token。
 */
public record CanvasNodeSummary(
        String nodeId,
        String type,
        Long assetId
) {}
