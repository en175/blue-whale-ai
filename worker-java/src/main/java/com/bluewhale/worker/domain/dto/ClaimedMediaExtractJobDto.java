package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 媒体提取作业领取投影（契约 附录 B：ClaimedMediaExtractJobDto，types.ts:65-72；
 * 迁移契约 §18 / IKH28W 起扩为轮询骨架富投影）。
 * <p>
 * 字段名与 TS 投影一致（camelCase）；providerTaskId / pollCount / progress 三字段对齐
 * {@link ClaimedVideoSubtitleEraseJobDto}（复用视频轮询骨架的分相判据与超限判定），
 * 差异 = 本投影沿用既有 camelCase 键（projectId / userId），不做历史改名。
 * <p>
 * parentProviderTaskId（IKI89P / ADR-0114）：手动重试 job 收割父任务上游结果的入口投影。
 * 同族旧口径「重试 = 沿用冻结 input 的新 job，免费工具无二次扣费面」只算了用户计费面，
 * 漏了上游成本面——超窗重试整轮重复消耗上游费用；本字段随收割机制（视频 IKEA26 先例
 * 推广）落地，语义见 claim 投影与处理器 submit 相。
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
        int progress,
        /**
         * IKI89P（ADR-0114）：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * 重试收割：submit 相先查父任务上游，成功且结果 URL 齐全则复用旧结果发布，
         * 防重复上游费用（非重试 job 恒 null，不查父任务）。
         */
        String parentProviderTaskId
) {}
