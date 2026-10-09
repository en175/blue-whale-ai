package com.bluewhale.worker.domain.dto;

import java.util.List;

public record PublishVocalSplitDto(
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        List<PublishVocalSplitTrackDto> tracks
) {

    public record PublishVocalSplitTrackDto(
            String trackType,
            String url,
            String storageKey,
            String mime,
            long size,
            String md5,
            Double durationSec
    ) {}
}
