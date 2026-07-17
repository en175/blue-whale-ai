package com.blue.whale.agent.service.governance;

import java.util.Map;

/**
 * 生成图片内容审核请求：供应商结果已私有落盘、尚未产品接纳时的受审事实。
 */
public record ReviewEvidenceRequest(
        Long projectId,
        Long userId,
        Long jobId,
        int slotIndex,
        String contentDigest,
        String mimeType,
        Map<String, Object> input) {
}
