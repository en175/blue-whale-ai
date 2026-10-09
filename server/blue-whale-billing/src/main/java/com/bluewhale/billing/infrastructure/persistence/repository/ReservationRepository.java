package com.bluewhale.billing.infrastructure.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.CostReservationEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.CostReservationMapper;
import com.bluewhale.billing.infrastructure.persistence.row.StaleReservationRow;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ReservationRepository {

    private final CostReservationMapper mapper;
    private final ObjectMapper json = new ObjectMapper();

    public ReservationRepository(CostReservationMapper mapper) {
        this.mapper = mapper;
    }

    public long insert(long jobId, long userId, long reservedCredits,
                       int catalogVersion, int discountBp, String ruleSnapshot, String title,
                       List<Allocation> allocations) {
        CostReservationEntity entity = new CostReservationEntity();
        entity.setGenerationJobId(jobId);
        entity.setUserId(userId);
        entity.setReservedCredits(reservedCredits);
        entity.setStatus(Reservation.Status.HELD.key());
        entity.setAllocations(writeAllocations(allocations));
        entity.setCatalogVersion(catalogVersion);
        entity.setDiscountBp(discountBp);
        entity.setRuleSnapshot(ruleSnapshot == null || ruleSnapshot.isBlank() ? null : ruleSnapshot);
        entity.setTitle(title == null ? "" : title);
        mapper.insert(entity);
        return entity.getId();
    }

    public Optional<Reservation> findByJobId(long jobId) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<CostReservationEntity>()
                .eq(CostReservationEntity::getGenerationJobId, jobId)))
                .map(ReservationRepository::toReservation);
    }

    public Reservation lockByJobId(long jobId) {
        CostReservationEntity entity = mapper.lockByJobId(jobId);
        return entity == null ? null : toReservation(entity);
    }

    public void markSettled(long jobId, long actualCredits, long receivableCredits) {
        mapper.markSettled(jobId, actualCredits, receivableCredits);
    }

    public void markReleased(long jobId, String releaseNote) {
        mapper.markReleased(jobId, releaseNote);
    }

    public long sumSettledActualCredits(LocalDateTime from, LocalDateTime to) {
        return mapper.sumSettledActualCredits(from, to);
    }

    public Map<Long, Long> sumSettledActualByUser(List<Long> userIds) {
        return UserAmountRow.toMap(mapper.sumSettledActualByUser(userIds));
    }

    public List<StaleHold> listStaleHeld(Duration olderThan, int limit) {
        return mapper.listStaleHeld(olderThan.getSeconds(), limit).stream()
                .map(ReservationRepository::toStaleHold)
                .toList();
    }

    public record StaleHold(long jobId, long userId, long reservedCredits, long heldSeconds) {

        public long heldHours() {
            return heldSeconds / 3600;
        }
    }

    private static StaleHold toStaleHold(StaleReservationRow row) {
        return new StaleHold(row.getGenerationJobId(), row.getUserId(),
                row.getReservedCredits(), row.getHeldSeconds());
    }

    private static Reservation toReservation(CostReservationEntity entity) {
        return new Reservation(
                entity.getId(),
                entity.getGenerationJobId(),
                entity.getUserId(),
                entity.getReservedCredits(),
                entity.getActualCredits(),
                entity.getReceivableCredits(),
                Reservation.Status.of(entity.getStatus()),
                readAllocations(entity.getAllocations()),
                entity.getCatalogVersion(),
                entity.getDiscountBp(),
                entity.getRuleSnapshot(),
                entity.getTitle(),
                entity.getReleaseNote());
    }

    private String writeAllocations(List<Allocation> allocations) {
        try {
            return json.writeValueAsString(allocations);
        } catch (Exception e) {
            throw new IllegalStateException("预扣分配明细无法序列化", e);
        }
    }

    private static List<Allocation> readAllocations(String allocationsJson) {
        try {
            return new ObjectMapper().readValue(allocationsJson, new TypeReference<List<Allocation>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("预扣分配明细无法解析：" + allocationsJson, e);
        }
    }
}
