package com.bluewhale.worker.domain.dto;

import java.util.List;

public record PublishVideoSceneSplitDto(
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        Double durationSec,
        List<Segment> segments
) {

    public record Segment(
            int segmentIndex,
            double startTimeSec,
            double endTimeSec,
            String url,
            String storageKey,
            String mime,
            long size,
            String md5,
            Integer width,
            Integer height
    ) {}
}
