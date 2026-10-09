package com.bluewhale.worker.domain.dto;

import java.util.Map;

public record PublishMediaExtractDto(
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        String md5,
        Double duration
) {}
