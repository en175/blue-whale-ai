package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * read_canvas_node 响应（IK2QC7）：单个画布节点详情。
 *
 * 比 {@link CanvasNodeSummary} 多 {@code data}：节点原始 data 对象（前端 React Flow 定义，透传不解释）。
 * 未找到节点时端点抛 {@code RESOURCE_NOT_FOUND}，不返回此对象。
 */
public record CanvasNodeDetail(
        String nodeId,
        String type,
        Long assetId,
        JsonNode data
) {}
