package com.blue.whale.agent.model.dto;

import java.util.List;
import java.util.Map;

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
        Checkpoint checkpoint,
        List<AcceptedResult> acceptedResults
) {
    public record RunMessage(String role, String content) {
    }

    public record Checkpoint(
            Long checkpointId,
            String engine,
            String engineVersion,
            Integer adapterSchemaVersion,
            Object opaquePayload
    ) {
    }

    public record AcceptedResult(String actionId, String status, Map<String, Object> result) {
    }
}
