package com.bluewhale.billing.infrastructure.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.CostReservationEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.CostReservationMapper;
import com.bluewhale.billing.infrastructure.persistence.row.UserAmountRow;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

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

    public long insert(long jobId, long userId, long chargedCredits,
                       int catalogVersion, int discountBp, String ruleSnapshot, String title,
                       List<Allocation> allocations) {
        CostReservationEntity entity = new CostReservationEntity();
        entity.setGenerationJobId(jobId);
        entity.setUserId(userId);
        entity.setReservedCredits(chargedCredits);
        entity.setStatus(Reservation.Status.CHARGED.key());
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

    public void markRefunded(long jobId, String releaseNote) {
        mapper.markRefunded(jobId, releaseNote);
    }

    public long sumChargedCredits(LocalDateTime from, LocalDateTime to) {
        return mapper.sumChargedCredits(from, to);
    }

    public Map<Long, Long> sumChargedByUser(List<Long> userIds) {
        return UserAmountRow.toMap(mapper.sumChargedByUser(userIds));
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
