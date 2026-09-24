package com.bluewhale.worker.domain.dto;

/**
 * 智能抠像进度更新输入（IKHK99：completed 相单产物转存前的心跳续租通道，形态对齐
 * {@link UpdateVideoSceneSplitProgressDto} 的「进度 + 续租」复合语义——单产物无段扇出，
 * 进度保持 claim 快照值〔转存期间无可上报的新进度，续租是主目的，进度不倒退〕）。
 */
public record UpdateVideoMattingProgressDto(
        /** 目标任务 id（字符串承载 BigInt） */
        String jobId,
        String workerId,
        long fencingToken,
        int progress
) {}
