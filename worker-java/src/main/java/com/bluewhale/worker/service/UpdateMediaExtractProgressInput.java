package com.bluewhale.worker.service;

/**
 * 媒体提取进度更新输入（契约 附录 B：updateMediaExtractProgress，types.ts:168-173）。
 */
public record UpdateMediaExtractProgressInput(
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
