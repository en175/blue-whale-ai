package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;

public enum JobStatusEnum {

    QUEUED("queued"),

    PROCESSING("processing"),

    CHECKING("checking"),

    SUCCEEDED("succeeded"),

    PARTIALLY_SUCCEEDED("partially_succeeded"),

    FAILED("failed"),

    CANCELLED("cancelled");

    private final String value;

    JobStatusEnum(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }


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
