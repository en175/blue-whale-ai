package com.bluewhale.worker.service;

import java.util.Map;

/**
 * 媒体提取失败输入（契约 附录 B：failMediaExtractJob，types.ts:188-196）。
 */
public record FailMediaExtractInput(
        String jobId,
        String workerId,
        long fencingToken,
        String code,
        String message,
        Map<String, Object> details
) {}
