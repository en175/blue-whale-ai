package com.bluewhale.agent.model.dto;

import java.time.LocalDateTime;

/**
 * 资源响应（资产库页 {@code /assets}）。不含 {@code storageKey} 等内部字段。
 *
 * @param id        资源 id
 * @param type      image / video
 * @param url       可访问 url
 * @param width     宽
 * @param height    高
 * @param duration  视频时长（秒，图片为 null）
 * @param source    generated / uploaded
 * @param createdAt 创建时间
 */
public record AssetResponse(
        Long id,
        String type,
        String url,
        Integer width,
        Integer height,
        Integer duration,
        String source,
        LocalDateTime createdAt) {
}
