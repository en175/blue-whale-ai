package com.bluewhale.worker.service;

import java.util.Map;

/**
 * 媒体提取成功发布输入（契约 附录 B：publishMediaExtractResult，types.ts:175-186）。
 */
public record PublishMediaExtractInput(
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        Double duration
) {}
