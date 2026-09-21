package com.bluewhale.worker.domain.dto;

/**
 * 场景切分进度更新输入（IKH8BP 审查修复：completed 相逐段转存的心跳续租通道，
 * 形态对齐 UpdateMediaExtractProgressDto 的「进度 + 续租」复合语义）。
 */
public record UpdateVideoSceneSplitProgressDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
