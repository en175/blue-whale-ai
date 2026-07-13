package com.blue.whale.agent.model.dto;

/**
 * 画布响应：整体 GET 返回，{@code viewport}/{@code nodes} 为 JSON 字符串，前端 {@code JSON.parse} 后喂 React Flow。
 *
 * @param id        画布记录 id（无记录时为 null）
 * @param projectId 所属项目 id
 * @param viewport  视口 JSON 字符串
 * @param nodes     节点数组 JSON 字符串
 */
public record CanvasDto(Long id, Long projectId, String viewport, String nodes) {
}
