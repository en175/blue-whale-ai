package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 音频调速作业领取投影（IKHW5A，父单 IKHVYO；镜像 {@link ClaimedAudioTrimJobDto}——
 * 复用视频轮询骨架需要的富投影：providerTaskId / pollCount / progress，分相判据与
 * 超限判定同款）：
 * <ul>
 * <li>无 cancelRequested：音频调速无取消入口（官方无取消端点，家族「发出不取消」口径）</li>
 * <li>无 parentProviderTaskId：手动重试是沿用冻结 input（源 + speed）的新 job
 *     （免费工具无二次扣费面）</li>
 * </ul>
 */
public record ClaimedAudioSpeedJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        String projectId,
        String userId,
        /** 创建时冻结参数 JSON（source_asset_id / speed? + provider_credential） */
        Map<String, Object> input,
        /** 上游任务 id；null=未提交（分相判据：null→submit、非 null→poll） */
        String providerTaskId,
        /** 当前 workerId（领取后写入） */
        String workerId,
        /** 增后 fencing_token */
        long fencingToken,
        /** 已轮询次数（rescheduleProviderPoll 累计，轮询上限判定用） */
        int pollCount,
        /** 轮询进度（瞬时错误重排时保持不倒退） */
        int progress
) {}
