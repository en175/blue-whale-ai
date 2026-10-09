package com.bluewhale.billing.adapter.outbound.persistence.row;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class UserAmountRow {

    private Long userId;

    private Long amount;

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }

    public static Map<Long, Long> toMap(List<UserAmountRow> rows) {
        Map<Long, Long> result = new HashMap<>();
        for (UserAmountRow row : rows) {
            result.put(row.getUserId(), row.getAmount() == null ? 0L : row.getAmount());
        }
        return result;
    }
}
