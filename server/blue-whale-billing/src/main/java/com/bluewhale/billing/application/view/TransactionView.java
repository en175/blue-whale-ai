package com.bluewhale.billing.application.view;

import java.time.Instant;
import java.util.List;

public record TransactionView(
        String id,
        long userId,
        String type,
        String direction,
        String title,
        long amount,
        Long reservedCredits,
        Long generationJobId,
        String status,
        Instant createdAt,
        Instant settledAt
) {

    public record Page(List<TransactionView> items, long total) {

        public Page {
            items = List.copyOf(items);
        }
    }
}
