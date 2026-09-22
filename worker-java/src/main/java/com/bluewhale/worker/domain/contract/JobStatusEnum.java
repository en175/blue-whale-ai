package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;

/**
 * 生成作业状态枚举（契约 §2：generation_jobs.status 合法值）。
 * <p>
 * 值语义与 TS / DB 逐字一致，双端对账不可改字符串。
 * 变化轴：契约 §2 状态机（queued → processing → succeeded/partially_succeeded/failed/cancelled）。
 */
public enum JobStatusEnum {

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

    JobStatusEnum(String value) {
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

    // ========== 槽位聚合工具（从 JobStateMachineService 随刀④ 迁入，便于 Finalizer/Sync 复用） ==========

    /**
     * 逻辑槽折叠（generation-output-slot-repo.ts:28-43 resolveLogicalSlots）。
     * 同一 slot_index 的历史尝试折叠为一个逻辑槽：succeeded 永久终态保留；否则以最新尝试（id 最大）为准。
     */
    public static java.util.List<GenerationOutputSlotEntity> resolveLogicalSlots(
            java.util.List<GenerationOutputSlotEntity> slots) {
        java.util.Map<Integer, GenerationOutputSlotEntity> resolved = new java.util.LinkedHashMap<>();
        for (GenerationOutputSlotEntity slot : slots) {
            GenerationOutputSlotEntity current = resolved.get(slot.getSlotIndex());
            if (current == null
                    || !SUCCEEDED.value().equals(current.getStatus())
                    || SUCCEEDED.value().equals(slot.getStatus())) {
                resolved.put(slot.getSlotIndex(), slot);
            }
        }
        return resolved.values().stream()
                .sorted(java.util.Comparator.comparingInt(GenerationOutputSlotEntity::getSlotIndex))
                .toList();
    }

    /**
     * 槽位聚合汇总状态（generation-output-slot-repo.ts:15-24 aggregateSlotStatus）。
     * 四态（generating/partial/success/failed）与 job status（succeeded/partially_succeeded/failed）不同枚举，不混淆。
     */
    public static String aggregateSlotStatus(java.util.List<GenerationOutputSlotEntity> resolvedSlots) {
        if (resolvedSlots.isEmpty()) return "failed";
        boolean hasPending = resolvedSlots.stream()
                .anyMatch(s -> "pending".equals(s.getStatus()));
        if (hasPending) return "generating";
        long succeeded = resolvedSlots.stream()
                .filter(s -> SUCCEEDED.value().equals(s.getStatus())).count();
        if (succeeded == resolvedSlots.size()) return "success";
        if (succeeded == 0) return "failed";
        return "partial";
    }
}
