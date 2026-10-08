package com.bluewhale.worker.domain.dto;

public record UpdateVideoSceneSplitProgressDto(
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
