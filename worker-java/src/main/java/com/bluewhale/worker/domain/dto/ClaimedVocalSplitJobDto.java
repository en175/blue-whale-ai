package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 人声背景分离作业领取投影（IKHA2J，附录 C 触点④）。
 * <p>
 * 形态逐字对齐 {@link ClaimedMediaExtractJobDto}（camelCase 键，复用视频轮询骨架需要的
 * 富投影：providerTaskId / pollCount / progress）。差异同去字幕 / HD 高清口径：
 * <ul>
 *   <li>无 cancelRequested：人声分离无取消入口（官方无取消端点，家族「发出不取消」口径）</li>
 * </ul>
 * <p>
 * parentProviderTaskId（IKI89R / ADR-0114）：手动重试 job 收割父任务上游结果的入口投影。
 * 同族旧口径「重试 = 沿用冻结 input 的新 job，免费工具无二次扣费面」只算了用户计费面，
 * 漏了上游成本面——超窗重试整轮重复消耗上游费用；本字段随收割机制（视频 IKEA26 先例
 * 推广）落地，语义见 claim 投影与处理器 submit 相。
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
        int progress,
        /**
         * IKI89R（ADR-0114）：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * 重试收割：submit 相先查父任务上游，成功且轨数组齐全（2/3 轨对齐轮询相成功口径）
         * 则复用旧结果发布，防重复上游费用（非重试 job 恒 null，不查父任务）。
         */
        String parentProviderTaskId
) {}
