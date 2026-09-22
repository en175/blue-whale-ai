package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 媒体提取作业领取投影（契约 附录 B：ClaimedMediaExtractJobDto，types.ts:65-72；
 * 迁移契约 §18 / IKH28W 起扩为轮询骨架富投影）。
 * <p>
 * 字段名与 TS 投影一致（camelCase）；providerTaskId / pollCount / progress 三字段对齐
 * {@link ClaimedVideoSubtitleEraseJobDto}（复用视频轮询骨架的分相判据与超限判定），
 * 差异 = 本投影沿用既有 camelCase 键（projectId / userId），不做历史改名。
 */
public record ClaimedMediaExtractJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        String projectId,
        String userId,
        Map<String, Object> input,
        /** 上游任务 id；null=未提交（分相判据：null→submit、非 null→poll） */
        String providerTaskId,
        String workerId,
        long fencingToken,
        /** 已轮询次数（rescheduleProviderPoll 累计，轮询上限判定用） */
        int pollCount,
        /** 轮询进度（瞬时错误重排时保持不倒退） */
        int progress
) {}
