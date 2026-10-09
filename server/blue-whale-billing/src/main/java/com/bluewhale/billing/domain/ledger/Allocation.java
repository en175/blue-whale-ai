package com.bluewhale.billing.domain.ledger;

public record Allocation(long lotId, long take) {

    public Allocation {
        if (lotId <= 0) {
            throw new IllegalArgumentException("批次 id 必须为正：" + lotId);
        }
        if (take <= 0) {
            throw new IllegalArgumentException("分配量必须为正：" + take);
        }
    }
}
