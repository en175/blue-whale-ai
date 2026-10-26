package com.bluewhale.worker.domain.dto;

public record UpdateVideoMattingProgressDto(
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
