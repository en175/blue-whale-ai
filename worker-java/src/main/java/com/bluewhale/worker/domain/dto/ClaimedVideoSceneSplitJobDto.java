package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 视频场景切分作业领取投影（IKH8BP，父规格 IKH86V，附录 C 触点④）。
 * <p>
 * 形态对齐 {@link ClaimedVideoSubtitleEraseJobDto}（复用视频轮询骨架需要的富投影），
 * 差异：
 * <ul>
 *   <li>无 cancelRequested：场景切分无取消入口（家族「发出不取消」口径，规格 Out of Scope）</li>
 * </ul>
 * <p>
 * parentProviderTaskId（IKI89T / ADR-0114）：手动重试 job 收割父任务上游结果的入口投影。
 * 同族旧口径「重试 = 沿用冻结 input 的新 job，免费工具无二次扣费面」只算了用户计费面，
 * 漏了上游成本面——超窗重试整轮重复消耗上游费用；本字段随收割机制（视频 IKEA26 先例
 * 推广）落地，语义见 claim 投影与处理器 submit 相。
 * <p>
 * <b>snake_case 字段</b>（user_id / project_id 与 ClaimedVideoSubtitleEraseJobDto 逐字一致）。
 */
public record ClaimedVideoSceneSplitJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        /** 归属项目（claim 投影 → toString ?? "0"） */
        String project_id,
        /** 归属用户 */
        String user_id,
        /** 创建时冻结参数 JSON（两业务键 + provider_credential，IKH8BH 契约） */
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
        int progress,
        /**
         * IKI89T（ADR-0114）：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * 重试收割：submit 相先查父任务上游，成功且切片数组非空（对齐本家族轮询相成功
         * 口径）则复用旧结果发布，防重复上游费用（非重试 job 恒 null，不查父任务）。
         */
        String parentProviderTaskId
) {}
