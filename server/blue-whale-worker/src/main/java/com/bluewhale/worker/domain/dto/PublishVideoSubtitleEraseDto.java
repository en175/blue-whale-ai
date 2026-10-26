package com.bluewhale.worker.domain.dto;

public record PublishVideoSubtitleEraseDto(
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        String md5,
        Integer width,
        Integer height,
        Double durationSec
) {}
