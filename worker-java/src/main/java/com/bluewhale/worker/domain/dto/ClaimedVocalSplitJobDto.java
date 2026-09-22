package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 人声背景分离作业领取投影（IKHA2J，附录 C 触点④）。
 * <p>
 * 形态逐字对齐 {@link ClaimedMediaExtractJobDto}（camelCase 键，复用视频轮询骨架需要的
 * 富投影：providerTaskId / pollCount / progress）。差异同去字幕 / HD 高清口径：
 * <ul>
 *   <li>无 cancelRequested：人声分离无取消入口（官方无取消端点，家族「发出不取消」口径）</li>
 *   <li>无 parentProviderTaskId：手动重试是沿用冻结 input 的新 job（免费工具无二次扣费面）</li>
 * </ul>
 */
public record ClaimedVocalSplitJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        String projectId,
        String userId,
        /** 创建时冻结参数 JSON（三业务键 source_asset_id / scene / output_format + provider_credential） */
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
