package com.bluewhale.billing.application.command;

import java.util.List;

public record SettlementCommand(
        long jobId,
        long userId,
        String status,
        int catalogVersion,
        int succeededSlots,
        List<SettlementUsageLine> usage
) {

    public SettlementCommand {
        usage = usage == null ? List.of() : List.copyOf(usage);
    }
}
