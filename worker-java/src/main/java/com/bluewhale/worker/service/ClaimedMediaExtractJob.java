package com.bluewhale.worker.service;

import java.util.Map;

/**
 * 媒体提取作业领取投影（契约 附录 B：ClaimedMediaExtractJob，types.ts:65-72）。
 * <p>
 * 字段名与 TS 投影完全一致（camelCase）。
 */
public record ClaimedMediaExtractJob(
        String id,
        String projectId,
        String userId,
        Map<String, Object> input,
        String workerId,
        long fencingToken
) {}
