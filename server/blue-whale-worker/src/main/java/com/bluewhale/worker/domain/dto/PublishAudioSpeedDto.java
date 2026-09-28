package com.bluewhale.worker.domain.dto;

/**
 * 音频调速成功发布输入（IKHW5A，父单 IKHVYO；镜像 {@link PublishAudioTrimDto}——同为音频
 * 产物：type='audio' + duration 秒入 duration_ms，无宽高带宽）。
 */
public record PublishAudioSpeedDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String projectId,
        String userId,
        String workerId,
        long fencingToken,
        String url,
        String storageKey,
        String mime,
        long size,
        /** 产物字节的 md5（32 位小写 hex），落 assets.md5 供去重。 */
        String md5,
        /** 时长（秒；取官方 result.duration 精确值——调速产物时长 ≠ 源全长，不做源回落）。 */
        Double durationSec
) {}
