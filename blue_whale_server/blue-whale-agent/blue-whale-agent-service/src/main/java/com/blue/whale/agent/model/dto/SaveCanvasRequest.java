package com.blue.whale.agent.model.dto;

import javax.validation.constraints.NotNull;

/**
 * 保存画布请求：整体 PUT，{@code viewport} 与 {@code nodes} 为前端 React Flow 序列化的 JSON 字符串，
 * 后端不透明透传（见 ADR-0011 D3）。
 *
 * @param viewport 视口 JSON 字符串：{@code {x, y, zoom}}
 * @param nodes    节点数组 JSON 字符串：{@code [{id, type, position, data:{assetId, ...}}]}
 */
public record SaveCanvasRequest(@NotNull(message = "viewport 不能为空") String viewport,
                                @NotNull(message = "nodes 不能为空") String nodes) {
}
