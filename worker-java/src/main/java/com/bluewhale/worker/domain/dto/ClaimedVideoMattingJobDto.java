package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 智能抠像作业领取投影（IKHK99，父规格 IKHJRC，契约 IKHK7F）。
 * <p>
 * 形态逐字对齐 {@link ClaimedVideoEnhanceJobDto}（复用视频轮询骨架需要的富投影：
 * providerTaskId / pollCount / progress），差异同 HD 高清口径：
 * <ul>
 *   <li>无 cancelRequested：抠像无取消入口（官方无取消端点，家族「发出不取消」口径）</li>
 *   <li>parentProviderTaskId（IKI89Z / ADR-0114）：手动重试 job 收割父任务上游结果的入口
 *       投影。旧口径「无 parentProviderTaskId 属刻意（手动重试是沿用冻结 input 的新 job，
 *       免费工具无二次扣费面）」只算了用户计费面，漏了上游成本面——超窗重试整轮重复消耗
 *       上游费用，该立场已随收割机制落地推翻（视频 IKEA26 先例推广、IKI89P 定型形态平移），
 *       语义见 claim 投影与处理器 submit 相。</li>
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
        int progress,
        /**
         * IKI89Z（ADR-0114）：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * 重试收割：submit 相先查父任务上游，成功且结果齐全（videoUrl+resolution 双非空，
         * 对齐轮询相成功口径）则复用旧结果发布，防重复上游费用（非重试 job 恒 null，不查父任务）。
         */
        String parentProviderTaskId
) {}
