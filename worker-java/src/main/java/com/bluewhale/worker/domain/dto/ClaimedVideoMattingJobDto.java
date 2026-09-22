package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 智能抠像作业领取投影（IKHK99，父规格 IKHJRC，契约 IKHK7F）。
 * <p>
 * 形态逐字对齐 {@link ClaimedVideoEnhanceJobDto}（复用视频轮询骨架需要的富投影：
 * providerTaskId / pollCount / progress），差异同 HD 高清口径：
 * <ul>
 *   <li>无 cancelRequested：抠像无取消入口（官方无取消端点，家族「发出不取消」口径）</li>
 *   <li>无 parentProviderTaskId：手动重试是沿用冻结 input 的新 job（免费工具无二次扣费面）</li>
 * </ul>
 * <p>
 * <b>snake_case 字段</b>（user_id / project_id 与 ClaimedVideoJobDto 逐字一致）。
 */
public record ClaimedVideoMattingJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        /** 归属项目（claim 投影 → toString ?? "0"） */
        String project_id,
        /** 归属用户 */
        String user_id,
        /** 创建时冻结参数 JSON（source_asset_id / target_node_id / mode / format /
         *  background_color（仅 MP4）+ provider_credential） */
        Map<String, Object> input,
        /** 上游任务 id；null=未提交（分相判据：null→submit、非 null→poll） */
        String providerTaskId,
        /** 当前 workerId（领取后写入） */
        String workerId,
        /** 增后 fencing_token */
        long fencingToken,
        /** 已轮询次数（rescheduleProviderPoll 累计，轮询上限判定用） */
        int pollCount,
        /** 轮询进度（瞬时错误重排时保持不倒退；转存前心跳续租沿用本值） */
        int progress
) {}
