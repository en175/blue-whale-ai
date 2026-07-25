package com.blue.whale.agent.model.dto;

public record GenerationCancellationCommand(
        Long jobId,
        int slotIndex,
        Integer expectedJobVersion,
        Long fencingToken,
        String leaseOwner) {
}
