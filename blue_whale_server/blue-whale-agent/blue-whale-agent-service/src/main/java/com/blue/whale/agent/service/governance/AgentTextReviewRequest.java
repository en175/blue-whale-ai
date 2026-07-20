package com.blue.whale.agent.service.governance;

import java.util.Map;

public record AgentTextReviewRequest(
        Long projectId,
        Long userId,
        Long agentRunId,
        String streamId,
        String subjectId,
        String content,
        String contentDigest,
        Map<String, Object> evidenceHint) {
}
