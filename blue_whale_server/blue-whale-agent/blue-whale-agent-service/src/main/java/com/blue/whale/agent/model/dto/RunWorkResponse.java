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
        String bundleVersionId,
        String manifestDigest,
        String modelProfileId,
        String modelProfileVersion,
        Object activatedCreativeSkillVersions,
        List<RunMessage> messages,
        Checkpoint checkpoint,
        List<AcceptedResult> acceptedResults,
        String toolGrants
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
