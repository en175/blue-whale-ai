package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.LedgerEntryEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.LedgerEntryMapper;
import org.springframework.stereotype.Repository;

import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.LedgerEntry;
import com.bluewhale.billing.domain.ledger.Voucher;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Repository
public class LedgerRepository {

    private final LedgerEntryMapper mapper;

    public LedgerRepository(LedgerEntryMapper mapper) {
        this.mapper = mapper;
    }

    public boolean existsByVoucherBase(String idempotencyBase) {
        return mapper.selectCount(new LambdaQueryWrapper<LedgerEntryEntity>()
                .likeRight(LedgerEntryEntity::getIdempotencyKey, idempotencyBase + ":")) > 0;
    }

    public void insert(Voucher voucher) {
        for (LedgerEntry leg : voucher.legs()) {
            Long previous = mapper.latestBalanceForUpdate(leg.userId(), leg.account().key());
            long after = (previous == null ? 0L : previous)
                    + leg.account().balanceDelta(leg.direction(), leg.amount());

            LedgerEntryEntity entity = new LedgerEntryEntity();
            entity.setUserId(leg.userId());
            entity.setAccount(leg.account().key());
            entity.setDirection(leg.direction().name().toLowerCase());
            entity.setAmount(leg.amount());
            entity.setBizType(leg.bizType());
            entity.setBizId(leg.bizId());
            entity.setIdempotencyKey(leg.idempotencyKey());
            entity.setBalanceAfter(after);
            entity.setRemark(leg.remark());
            mapper.insert(entity);
        }
    }

    public long balanceOf(long userId, Account account) {
        Long balance = mapper.latestBalance(userId, account.key());
        return balance == null ? 0L : balance;
    }

    public BreakScan findBalanceBreaks(long userId, int limit) {
        List<LedgerEntryEntity> entries = mapper.listRecentForAudit(userId, limit);

        List<BreakPoint> breaks = new ArrayList<>();
        Map<String, Long> previous = new HashMap<>();
        for (LedgerEntryEntity entry : entries) {
            long delta = Account.of(entry.getAccount())
                    .balanceDelta(directionOf(entry), entry.getAmount());
            long prev = previous.getOrDefault(entry.getAccount(), 0L);
            long expected = prev + delta;
            if (expected != entry.getBalanceAfter()) {
                breaks.add(new BreakPoint(entry.getId(), entry.getAccount(),
                        prev, expected, entry.getBalanceAfter()));
            }
            previous.put(entry.getAccount(), entry.getBalanceAfter());
        }
        return new BreakScan(breaks, entries.size() >= limit);
    }

    private static LedgerEntry.Direction directionOf(LedgerEntryEntity entry) {
        return LedgerEntry.Direction.valueOf(entry.getDirection().toUpperCase(Locale.ROOT));
    }

    public record BreakScan(List<BreakPoint> breaks, boolean windowFull) {
    }

    public record BreakPoint(long entryId, String account, long previousBalance,
                             long expectedBalance, long actualBalance) {
    }
}
