package com.bluewhale.worker.domain.dto;

/**
 * 重试收割（parent-reuse）上游任务观测的最小访问面（IKI8GN 收敛 / ADR-0114）。
 * <p>
 * 8 个 MediaKit 家族的 {@code XxxTaskObservation} 共享收割骨架（ParentResultReuse）所需的
 * 上游状态访问器。成功态字面量现状 8 家族同值（{@value #STATUS_SUCCEEDED}，火山 MediaKit
 * 统一口径），由共享骨架统一判定；将来家族分化时再下沉为家族参数。
 */
public interface ParentTaskObservation {

    /** MediaKit 家族统一的上游成功态字面量。 */
    String STATUS_SUCCEEDED = "succeeded";

    /** 上游任务状态。 */
    String status();
}
