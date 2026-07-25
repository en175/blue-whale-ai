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
        Object autoCreativeSkillCandidates,
        List<RunMessage> messages,
        Checkpoint checkpoint,
        List<AcceptedResult> acceptedResults,
        String toolGrants,
        // IK2QC8 紧凑初始上下文（契约 §6.1）：摘要 + 画布媒体节点 + 有界最近窗口。
        // messages 语义收窄为最近窗口，conversationSummary / canvasNodes 可空。
        ConversationSummaryResponse conversationSummary,
        List<CanvasNodeSummary> canvasNodes
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
