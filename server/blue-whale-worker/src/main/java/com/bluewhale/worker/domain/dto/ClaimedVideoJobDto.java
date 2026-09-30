package com.bluewhale.worker.domain.dto;

import java.util.Map;

/**
 * 视频作业领取投影（claim-ops.ts:255-330 claimVideoJobById 逐字移植）。
 * <p>
 * 比 ClaimedJobDto（图片/音频共用）多出的字段：
 * <ul>
 *   <li>pollCount：已轮询次数（rescheduleProviderPoll 累计，IKBBXH 上限 720 判定用）</li>
 *   <li>progress：轮询进度（IKEA26 瞬时错误重排时保持不倒退）</li>
 *   <li>providerTaskId：上游任务 id（null=未提交，分相判据）</li>
 *   <li>parentProviderTaskId：IKEA26 父 job 的 provider_task_id（retry job 防双扣）</li>
 * </ul>
 * <p>
 * <b>修正一</b>：reservedAmountFen 不在投影范围（claim-ops.ts 原 :65 字段删除）。
 * <p>
 * <b>snake_case 字段</b>（与 TS VideoJobClaim 投影逐字一致，video-job-runner.ts:48-66）。
 */
public record ClaimedVideoJobDto(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        /** 归属项目（claim-ops.ts → toString ?? "0"） */
        String project_id,
        /** 归属用户 */
        String user_id,
        /** 创建时冻结参数 JSON（provider_credential / prompt / model_id / duration / references…） */
        Map<String, Object> input,
        /** 上游任务 id；null=未提交（video 分相判据，契约 §3.2/§3.3） */
        String providerTaskId,
        /** 取消请求标记（cancel_requested_at != null → true） */
        boolean cancelRequested,
        /** 当前 workerId（领取后写入） */
        String workerId,
        /** 增后 fencing_token（candidate.fencing_token + 1n → Number()） */
        long fencingToken,
        /** 已轮询次数（rescheduleProviderPoll 累计，IKBBXH：轮询上限 720 判定用） */
        int pollCount,
        /** 轮询进度（IKEA26：瞬时网络错误重排时保持进度不倒退） */
        int progress,
        /**
         * IKEA26：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * 第 3 层防双扣：retry job 先查上游旧 task 状态，SUCCESS → 复用结果不重新 submit。
         */
        String parentProviderTaskId,
        /**
         * IKIZQC：两阶段视频阶段（generation_jobs.video_stage；null = 普通视频）。
         * 'final' = 成片——提交相走网关 finalize（引用来源样片的公开任务 ID，不重建
         * Draft 输入），成功前转存禁用供应商 URL 直存降级（金标 G14 两阶段同规）。
         */
        String videoStage,
        /**
         * IKIZQC：来源样片保存的**网关公开** task ID（video_stage='final' 且
         * source_sample_job_id 非空时查；其余 null）。私有上游 Draft ID 不出网关
         * （IKIZBR）——本仓从头到尾只持有公开 ID。
         */
        String sourceSampleProviderTaskId
) {
        /** 既有 11 参形态：普通视频（非两阶段），阶段两字段缺省 null，旧调用点零改动。 */
        public ClaimedVideoJobDto(
                String id, String project_id, String user_id, Map<String, Object> input,
                String providerTaskId, boolean cancelRequested, String workerId,
                long fencingToken, int pollCount, int progress, String parentProviderTaskId) {
                this(id, project_id, user_id, input, providerTaskId, cancelRequested, workerId,
                        fencingToken, pollCount, progress, parentProviderTaskId, null, null);
        }
}
