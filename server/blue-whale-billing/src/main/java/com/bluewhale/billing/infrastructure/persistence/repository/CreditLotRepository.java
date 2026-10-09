package com.bluewhale.billing.infrastructure.persistence.repository;

import com.bluewhale.billing.domain.DbTime;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.CreditLotEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.CreditLotMapper;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;












@Repository
public class CreditLotRepository {

    private final CreditLotMapper mapper;

    public CreditLotRepository(CreditLotMapper mapper) {
        this.mapper = mapper;
    }









    public record Lot(long id, long userId, CreditSource source, long amount,
                      long remaining, long frozen, Instant expiresAt, int version) {
        public long available() {
            return remaining - frozen;
        }
    }






    public List<Lot> lockActiveLots(long userId) {
        return mapper.lockActiveLots(userId).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }








    public Lot lockById(long lotId) {
        CreditLotEntity entity = mapper.lockById(lotId);
        return entity == null ? null : toLot(entity);
    }






    public List<Lot> listDueLots(int limit) {
        return mapper.listDueLots(limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }














    public String findBizIdByGrantKey(String grantKey) {
        CreditLotEntity entity = mapper.selectOne(new LambdaQueryWrapper<CreditLotEntity>()
                .eq(CreditLotEntity::getGrantKey, grantKey)
                .select(CreditLotEntity::getBizId));
        return entity == null ? null : entity.getBizId();
    }


    public long availableCredits(long userId) {
        return mapper.sumAvailable(userId);
    }











    public Map<Long, Long> availableCreditsOf(List<Long> userIds) {
        return UserAmountRow.toMap(mapper.sumAvailableByUser(userIds));
    }











    public Map<Long, Long> grantedCreditsOf(List<Long> userIds, CreditSource source) {
        return UserAmountRow.toMap(mapper.sumGrantedByUser(userIds, source.key()));
    }












    public List<SourceAvailable> availableCreditsBySource(long userId) {
        return mapper.sumAvailableBySource(userId).stream()
                .map(row -> new SourceAvailable(CreditSource.of(row.getSource()),
                        row.getCredits() == null ? 0L : row.getCredits()))
                .toList();
    }







    public record SourceAvailable(CreditSource source, long credits) {}



















    public record UserLot(long id, CreditSource source, long amount, long remaining,
                          Instant createdAt, Instant expiresAt,
                          String bizType, String bizId) {}







    public record UserLotPage(List<UserLot> items, long total) {
        public UserLotPage {
            items = List.copyOf(items);
        }
    }












    public UserLotPage listUserLots(long userId, int size, int page) {
        long offset = (long) (Math.max(page, 1) - 1) * size;
        List<UserLot> items = mapper.listUserLots(userId, offset, size).stream()
                .map(CreditLotRepository::toUserLot)
                .toList();
        return new UserLotPage(items, mapper.countUserLots(userId));
    }

    private static UserLot toUserLot(CreditLotEntity entity) {
        long remaining = entity.getRemaining() == null ? 0L : entity.getRemaining();
        long frozen = entity.getFrozen() == null ? 0L : entity.getFrozen();
        return new UserLot(
                entity.getId(),
                CreditSource.of(entity.getSource()),
                entity.getAmount() == null ? 0L : entity.getAmount(),

                remaining - frozen,
                DbTime.fromDb(entity.getGmtCreate()),
                DbTime.fromDb(entity.getExpiresAt()),


                entity.getBizType() == null ? "" : entity.getBizType(),
                entity.getBizId() == null ? "" : entity.getBizId());
    }

    public List<Lot> listExpiring(long userId, int limit) {
        return mapper.listExpiring(userId, limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }


    public void addFrozen(long lotId, long amount) {
        mapper.addFrozen(lotId, amount);
    }


    public void releaseFrozen(long lotId, long amount) {
        mapper.releaseFrozen(lotId, amount);
    }







    public void expire(long lotId, long amount) {
        mapper.expireLot(lotId, amount);
    }







    public void settle(long lotId, long frozenTake, long actualTake) {
        mapper.settle(lotId, frozenTake, actualTake);
    }







    public long grant(long userId, CreditSource source, long amount, Instant expiresAt,
                      String bizType, String bizId, String grantKey) {
        CreditLotEntity entity = new CreditLotEntity();
        entity.setUserId(userId);
        entity.setSource(source.key());

        entity.setSourcePriority(source.priority());
        entity.setAmount(amount);
        entity.setRemaining(amount);
        entity.setFrozen(0L);
        entity.setExpiresAt(DbTime.toDb(expiresAt));
        entity.setBizType(bizType);
        entity.setBizId(bizId);
        entity.setGrantKey(grantKey);

        mapper.insert(entity);
        return entity.getId();
    }


    public long availableOf(long lotId) {
        CreditLotEntity entity = mapper.selectById(lotId);
        return entity == null ? 0L : entity.getRemaining() - entity.getFrozen();
    }







    public CreditSource sourceOf(long lotId) {
        CreditLotEntity entity = mapper.selectById(lotId);
        if (entity == null) {
            throw new IllegalArgumentException("批次不存在：" + lotId);
        }
        return CreditSource.of(entity.getSource());
    }

    private static Lot toLot(CreditLotEntity entity) {
        return new Lot(
                entity.getId(),
                entity.getUserId(),
                CreditSource.of(entity.getSource()),
                entity.getAmount(),
                entity.getRemaining(),
                entity.getFrozen(),
                DbTime.fromDb(entity.getExpiresAt()),


                entity.getVersion() == null ? 0 : entity.getVersion());
    }
}
