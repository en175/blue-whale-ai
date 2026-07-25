package com.blue.whale.agent.model.dto;

public record RunCommitResponse(
        Long checkpointId,
        Long generationJobId,
        Long inputRequestId,
        Long cursor) {
}
