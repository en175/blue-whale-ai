package com.bluewhale.worker.domain.dto;

import java.util.Map;

public record ClaimedJobDto(
        String id,
        String project_id,
        String user_id,
        String type,
        Map<String, Object> input,
        int retry_count,
        boolean cancelRequested,
        long fencingToken
) {}
