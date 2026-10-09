package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.bluewhale.billing.adapter.outbound.persistence.mapper.ReconciliationMapper;
import com.bluewhale.billing.adapter.outbound.persistence.row.UserImbalanceRow;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ReconciliationRepository {

    private final ReconciliationMapper mapper;

    public ReconciliationRepository(ReconciliationMapper mapper) {
        this.mapper = mapper;
    }

    public GlobalTotals globalTotals() {
        return new GlobalTotals(mapper.sumLotsRemaining(), mapper.sumLedgerBalance());
    }

    public List<UserImbalance> imbalancedUsers(int limit) {
        return mapper.imbalancedUsers(limit).stream()
                .map(ReconciliationRepository::toImbalance)
                .toList();
    }

    private static UserImbalance toImbalance(UserImbalanceRow row) {
        return new UserImbalance(row.getUserId(), row.getLotsRemaining(), row.getLedgerTotal());
    }

    public record GlobalTotals(long lotsRemaining, long ledgerTotal) {

        public long diff() {
            return lotsRemaining - ledgerTotal;
        }

        public boolean balanced() {
            return diff() == 0;
        }
    }

    public record UserImbalance(long userId, long lotsRemaining, long ledgerTotal) {

        public long diff() {
            return lotsRemaining - ledgerTotal;
        }
    }
}
