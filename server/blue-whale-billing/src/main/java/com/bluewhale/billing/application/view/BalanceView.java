package com.bluewhale.billing.application.view;

import java.time.LocalDateTime;
import java.util.List;

public record BalanceView(long availableCredits, List<ExpiringLot> expiring,
                          List<SourceCredits> bySource) {

    public BalanceView {
        expiring = List.copyOf(expiring);
        bySource = List.copyOf(bySource);
    }

    public record ExpiringLot(long credits, LocalDateTime expiresAt, String source) {}

    public record SourceCredits(String source, long credits) {}
}
