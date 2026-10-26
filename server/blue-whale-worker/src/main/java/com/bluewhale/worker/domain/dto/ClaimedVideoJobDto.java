package com.bluewhale.worker.domain.dto;

import java.util.Map;

public record ClaimedVideoJobDto(
        String id,
        String project_id,
        String user_id,
        Map<String, Object> input,
        String providerTaskId,
        boolean cancelRequested,
        String workerId,
        long fencingToken,
        int pollCount,
        int progress,
        String parentProviderTaskId,
        String videoStage,
        String sourceSampleProviderTaskId
) {
        public ClaimedVideoJobDto(
                String id, String project_id, String user_id, Map<String, Object> input,
                String providerTaskId, boolean cancelRequested, String workerId,
                long fencingToken, int pollCount, int progress, String parentProviderTaskId) {
                this(id, project_id, user_id, input, providerTaskId, cancelRequested, workerId,
                        fencingToken, pollCount, progress, parentProviderTaskId, null, null);
        }
}
