package com.bluewhale.billing.infrastructure.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.LedgerEntryEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.LedgerEntryMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.LedgerEntry;
import com.bluewhale.billing.domain.ledger.Voucher;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Repository
public class LedgerRepository {

    private static final Logger log = LoggerFactory.getLogger(LedgerRepository.class);

    private static final int LOCK_TIMEOUT_SECONDS = 10;

    private final LedgerEntryMapper mapper;
    private final DataSource dataSource;

    public LedgerRepository(LedgerEntryMapper mapper, DataSource dataSource) {
        this.mapper = mapper;
        this.dataSource = dataSource;
    }

    public boolean existsByVoucherBase(String idempotencyBase) {
        return mapper.selectCount(new LambdaQueryWrapper<LedgerEntryEntity>()
                .likeRight(LedgerEntryEntity::getIdempotencyKey, idempotencyBase + ":")) > 0;
    }

    public void insert(Voucher voucher) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("账本写入必须在事务内执行");
        }
        long userId = voucher.legs().get(0).userId();
        String lockName = "billing:ledger:" + userId;
        Connection connection = acquireLock(lockName);
        AtomicBoolean released = new AtomicBoolean();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                releaseLock(connection, lockName, released);
            }

            @Override
            public void afterCompletion(int status) {
                releaseLock(connection, lockName, released);
            }
        });
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

    private Connection acquireLock(String name) {
        Connection connection = DataSourceUtils.getConnection(dataSource);
        try (PreparedStatement statement = connection.prepareStatement("SELECT GET_LOCK(?, ?)")) {
            statement.setString(1, name);
            statement.setInt(2, LOCK_TIMEOUT_SECONDS);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || result.getInt(1) != 1) {
                    throw new IllegalStateException("账本写入锁获取失败：" + name);
                }
            }
            return connection;
        } catch (SQLException error) {
            throw new IllegalStateException("账本写入锁获取失败：" + name, error);
        }
    }

    private void releaseLock(Connection connection, String name, AtomicBoolean released) {
        if (released.get()) {
            return;
        }
        try (PreparedStatement statement = connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
            statement.setString(1, name);
            statement.executeQuery();
            released.set(true);
        } catch (SQLException error) {
            log.warn("账本写入锁释放失败：{}（连接归还连接池时会话结束后自动释放）", name, error);
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
