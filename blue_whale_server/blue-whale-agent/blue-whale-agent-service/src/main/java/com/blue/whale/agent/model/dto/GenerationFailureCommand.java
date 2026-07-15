package com.blue.whale.agent.model.dto;

public record GenerationFailureCommand(
        Long jobId,
        int slotIndex,
        Integer expectedJobVersion,
        Long fencingToken,
        String leaseOwner,
        String errorCode,
        String errorMessage) {
}
