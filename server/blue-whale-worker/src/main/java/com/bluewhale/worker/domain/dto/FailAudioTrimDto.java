package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 音频截取失败输入（IKHB6S；镜像 {@link FailMediaExtractDto}，守卫同款，
 * details.raw 透传原始原因）。
 */
public record FailAudioTrimDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String workerId,
        long fencingToken,
        String code,
        String message,
        Map<String, Object> details
) {}
