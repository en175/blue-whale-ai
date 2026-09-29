package com.bluewhale.worker.domain.dto;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 已领取任务（ClaimedJob）—— Worker 依租约接管一个 GenerationJob 执行责任的独享视图。
 * <p>
 * <b>单一概念、单一形态</b>（IKIWP8 / ADR-0119）：本 record 是 GLOSSARY.md 所定义「公共核心
 * + 按类型的 payload 扩展」的唯一落地形态。此前 15 个 {@code Claimed*JobDto} 按家族各写一份，
 * 字段分布实测是正交特征表而非层次（「轮询」与「生成」不互斥、「取消」跨三类形态），单继承表达
 * 不了，故收敛为一条宽 record，不适用的字段留 {@code null} / {@code 0} / {@code false}。
 * <p>
 * 「这个字段对本家族无意义」的判断交给写处理器的作者——他是唯一知道自己家族形态的人。
 * <p>
 * <b>字段键为 camelCase</b>（IKIWP8 统一口径）。此前 media_extract / audio_* / vocal_split /
 * image_* 一族用 camelCase、video 一族用 snake_case（{@code project_id} / {@code user_id}），
 * 源头是 TS 侧 {@code claim-ops.ts} 自身就有两套键。Java 侧这些 record 不出 wire——全仓引用点
 * 只有 JobClaimService / 各处理器 / 测试 / 迁移契约文档，无 JSON 序列化点、无跨语言字段名 parity
 * 门禁——故统一为 camelCase。
 */
public record ClaimedJob(
        /** 主键（BigInt，对外字符串化承载） */
        String id,
        /** 归属项目（claim 投影 → toString ?? "0"） */
        String projectId,
        /** 归属用户 */
        String userId,
        /** 创建时冻结参数 JSON（provider_credential / prompt / model_id / references…） */
        Map<String, Object> input,
        /** 作业类型（generation_jobs.type，供处理器日志与 spec 排他对口测试使用） */
        String type,
        /** 上游任务 id；null = 未提交（轮询族的分相判据：null → submit 相、非 null → poll 相） */
        String providerTaskId,
        /** 取消请求标记（cancel_requested_at != null）；无取消入口的家族恒 false */
        boolean cancelRequested,
        /** 当前 workerId（领取后写入） */
        String workerId,
        /** 增后 fencing_token（candidate.fencing_token + 1） */
        long fencingToken,
        /** 已轮询次数（rescheduleProviderPoll 累计；轮询上限判定用；同步工具恒 0） */
        int pollCount,
        /** 轮询进度（瞬时错误重排时保持不倒退；同步工具恒 0） */
        int progress,
        /** 任务创建时间（可选投影，仅部分家族此前投影） */
        LocalDateTime createdAt,
        /** 执行截止时间（可选投影，仅部分家族此前投影） */
        LocalDateTime executionDeadlineAt,
        /**
         * 父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
         * <p>
         * 重试收割（parent-reuse，ADR-0114）：submit 相先查父任务上游，成功且结果齐全则复用旧结果
         * 发布，防重复上游费用。非重试 job 恒 null。9 个轮询族**全部**投影本字段（IKIWP8 前
         * audio_speed 是唯一漏项）。
         */
        String parentProviderTaskId
) implements ParentReuseClaim {}
