package com.blue.whale.agent.model.dto;

import java.util.Map;
import java.time.LocalDateTime;

public record GenerationJobClaim(
        Long jobId,
        Long projectId,
        Long userId,
        Integer jobVersion,
        Long fencingToken,
        String leaseOwner,
        Map<String, Object> input,
        String type,
        String status,
        LocalDateTime executionDeadlineAt) {

    public GenerationJobClaim(
            Long jobId,
            Long projectId,
            Long userId,
            Integer jobVersion,
            Long fencingToken,
            String leaseOwner,
            Map<String, Object> input) {
        this(jobId, projectId, userId, jobVersion, fencingToken, leaseOwner, input,
                "image", "processing", null);
    }
}
