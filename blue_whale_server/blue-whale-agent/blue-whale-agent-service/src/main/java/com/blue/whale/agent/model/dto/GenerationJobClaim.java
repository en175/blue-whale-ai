package com.blue.whale.agent.model.dto;

import java.util.Map;

public record GenerationJobClaim(
        Long jobId,
        Long projectId,
        Long userId,
        Integer jobVersion,
        Long fencingToken,
        String leaseOwner,
        Map<String, Object> input) {
}
