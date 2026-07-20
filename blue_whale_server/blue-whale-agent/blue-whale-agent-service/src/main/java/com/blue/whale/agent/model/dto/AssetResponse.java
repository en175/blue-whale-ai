package com.blue.whale.agent.model.dto;

import java.time.LocalDateTime;

/**
 * 资产详情响应（{@code GET /assets/{id}}），按 id 取单个 asset。
 *
 * @param id        资产 id
 * @param projectId 所属项目 ID
 * @param type      资源类型：image / video
 * @param url       TOS 可访问 url
 * @param width     宽
 * @param height    高
 * @param duration  视频时长（秒）
 * @param source    来源：generated / uploaded
 * @param createdAt 创建时间
 */
public record AssetResponse(Long id, Long projectId, String type, String url,
                            Integer width, Integer height, Integer duration,
                            String source, LocalDateTime createdAt) {
}
