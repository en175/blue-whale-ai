package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 图片抠图作业领取投影（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXM2；
 * 镜像 ClaimedImageEraseJobDto 的单槽免费工具形态）。字段名与 TS 投影一致（camelCase）。
 */
public record ClaimedImageCutoutJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        String projectId,
        String userId,
        Map<String, Object> input,
        String workerId,
        long fencingToken
) {}
