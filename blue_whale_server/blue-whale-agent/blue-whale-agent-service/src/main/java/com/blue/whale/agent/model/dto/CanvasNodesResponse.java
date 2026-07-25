package com.blue.whale.agent.model.dto;

import java.util.List;

/**
 * list_canvas_nodes 响应（IK2QC7）：当前 Project 画布的节点摘要列表。
 *
 * 以 runId 为根经租约鉴权后按 {@code run.projectId} 取唯一画布；canvasId 为画布主键（无画布时 null），
 * nodes 为紧凑节点摘要。空画布返 {@code nodes=[]}。
 */
public record CanvasNodesResponse(
        Long canvasId,
        List<CanvasNodeSummary> nodes
) {}
