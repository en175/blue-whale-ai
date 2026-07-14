package com.blue.whale.agent.model.dto;

public record GenerationFailureCommand(
        Long jobId,
        Integer expectedJobVersion,
        Long fencingToken,
        String leaseOwner,
        String errorCode,
        String errorMessage) {
}
