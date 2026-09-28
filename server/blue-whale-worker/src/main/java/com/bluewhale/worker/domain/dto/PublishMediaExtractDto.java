package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 媒体提取成功发布输入（契约 附录 B：publishMediaExtractResult，types.ts:175-186）。
 */
public record PublishMediaExtractDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        /** IKGS73：产物字节的 md5（32 位小写 hex），落 assets.md5 供去重。 */
        String md5,
        Double duration
) {}
