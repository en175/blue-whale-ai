package com.bluewhale.worker.domain.entity;

/**
 * 生成作业状态枚举（契约 §2：generation_jobs.status 合法值）。
 * <p>
 * 值语义与 TS / DB 逐字一致，双端对账不可改字符串。
 * 变化轴：契约 §2 状态机（queued → processing → succeeded/partially_succeeded/failed/cancelled）。
 */
public enum JobStatus {

    /** 排队等待 claim（可被领取）。 */
    QUEUED("queued"),

    /** 已领取 / 执行中（持租约）。 */
    PROCESSING("processing"),

    /** 全部 slot 成功。 */
    SUCCEEDED("succeeded"),

    /** 部分 slot 成功（slot 聚合改写产生，settle-ops.ts:104-121）。 */
    PARTIALLY_SUCCEEDED("partially_succeeded"),

    /** 全部失败 / 终态。 */
    FAILED("failed"),

    /** 已取消（claim 后派发前，provider_task_id IS NULL 守卫）。 */
    CANCELLED("cancelled");

    private final String value;

    JobStatus(String value) {
        this.value = value;
    }

    /** DB 合法值（与 schema.prisma / TS 一致）。 */
    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
