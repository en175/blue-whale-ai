package com.bluewhale.worker.domain.dto;

/**
 * 媒体提取进度更新输入（契约 附录 B：updateMediaExtractProgress，types.ts:168-173）。
 */
public record UpdateMediaExtractProgressDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
