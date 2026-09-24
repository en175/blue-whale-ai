package com.bluewhale.worker.domain.dto;

/**
 * 重试收割（parent-reuse）claim 投影的最小访问面（IKI8GN 收敛 / ADR-0114）。
 * <p>
 * 8 个 MediaKit 家族的 {@code ClaimedXxxJobDto} 共享收割骨架（ParentResultReuse）所需的
 * 两个访问器。各家族 record 组件名本就同形（id / parentProviderTaskId），本接口仅作静态
 * 类型锚点，无行为、无默认方法。视频生成家族（IKEA26 先例）不参与收敛，不实现本接口。
 */
public interface ParentReuseClaim {

    /** job 主键（BigInt，对外字符串化承载）。 */
    String id();

    /**
     * 父 job 的 provider_task_id（retry job 有 retry_of_job_id 时 claim 侧投影；
     * 非重试 job 恒 null，不查父任务）。
     */
    String parentProviderTaskId();
}
