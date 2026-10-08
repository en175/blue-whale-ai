package com.bluewhale.worker.domain.dto;

import java.util.Map;

public record FailMediaExtractDto(
        String jobId,
        String workerId,
        long fencingToken,
        String code,
        String message,
        Map<String, Object> details
) {}
