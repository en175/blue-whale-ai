package com.bluewhale.worker.domain.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record ClaimedJob(
        String id,
        String projectId,
        String userId,
        Map<String, Object> input,
        String type,
        String providerTaskId,
        boolean cancelRequested,
        String workerId,
        long fencingToken,
        int pollCount,
        int progress,
        LocalDateTime createdAt,
        LocalDateTime executionDeadlineAt,
        String parentProviderTaskId
) implements ParentReuseClaim {}
