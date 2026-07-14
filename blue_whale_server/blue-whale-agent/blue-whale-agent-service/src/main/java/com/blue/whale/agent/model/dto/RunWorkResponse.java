package com.blue.whale.agent.model.dto;

import java.util.List;

public record RunWorkResponse(
        Long agentRunId,
        Long projectId,
        Long conversationId,
        Long userId,
        Integer runVersion,
        Long fencingToken,
        String engine,
        String engineVersion,
        Integer adapterSchemaVersion,
        List<RunMessage> messages,
        Checkpoint checkpoint
) {
    public record RunMessage(String role, String content) {
    }

    public record Checkpoint(Long checkpointId, Object opaquePayload) {
    }
}
