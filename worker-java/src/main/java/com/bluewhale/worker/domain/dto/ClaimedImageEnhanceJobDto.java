package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 高清放大作业领取投影（契约 §14 / 附录 C 触点④；镜像 ClaimedMediaExtractJobDto 的
 * 单槽免费工具形态）。字段名与 TS 投影一致（camelCase）。
 */
public record ClaimedImageEnhanceJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        String projectId,
        String userId,
        Map<String, Object> input,
        String workerId,
        long fencingToken
) {}
