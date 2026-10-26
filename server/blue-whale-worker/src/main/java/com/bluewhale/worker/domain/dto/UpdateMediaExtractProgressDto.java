package com.bluewhale.worker.domain.dto;

public record UpdateMediaExtractProgressDto(
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
