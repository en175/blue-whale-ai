package com.bluewhale.worker.domain.dto;

import java.util.Map;

public record FailAudioSpeedDto(
        String jobId,
        String workerId,
        long fencingToken,
        String code,
        String message,
        Map<String, Object> details
) {}
