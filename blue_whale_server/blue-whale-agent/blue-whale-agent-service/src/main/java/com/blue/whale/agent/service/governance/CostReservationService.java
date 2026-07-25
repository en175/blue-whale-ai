package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.CostBudgetLockMapper;
import com.blue.whale.agent.mapper.CostReservationMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.entity.CostReservation;
import com.blue.whale.agent.model.entity.GenerationJob;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class CostReservationService {

    private final CostReservationMapper reservationMapper;
    private final CostBudgetLockMapper budgetLockMapper;
    private final GenerationJobMapper generationJobMapper;
    private final CostControlProperties properties;
    private final AuditRecordWriter auditRecordWriter;

    @Transactional
    public CostReservationSnapshot reserve(CostReservationCommand command) {
        requireValid(command);
        CostReservation existing = reservationMapper.selectByJobForUpdate(command.generationJobId());
        if (existing != null) {
            if (!sameReservation(existing, command)) {
                auditRecordWriter.appendDeniedCostDecision(
                        command, "RESERVATION_FACT_MISMATCH", properties.getRuleVersion());
                throw GovernanceException.actionNotAllowed();
            }
            return snapshot(existing);
        }
        if (command.quote().worstCaseFen() > properties.getActionHardLimitFen()) {
            denyAndThrow(command, "ACTION_HARD_LIMIT");
        }
        lockBudgetScopes(command);
        LocalDateTime now = reservationMapper.selectCurrentTime();
        long amount = command.quote().worstCaseFen();
        requireWithin(reservationMapper.sumGlobalSince(now.minusHours(24)), amount,
                properties.getGlobalDailyLimitFen(), command, "GLOBAL_DAILY_LIMIT");
        requireWithin(reservationMapper.sumProviderSince(command.quote().provider(), now.minusHours(24)), amount,
                properties.getProviderDailyLimitFen(), command, "PROVIDER_DAILY_LIMIT");
        requireWithin(reservationMapper.sumUserSince(command.userId(), now.minusHours(24)), amount,
                properties.getUserDailyLimitFen(), command, "USER_DAILY_LIMIT");
        requireWithin(reservationMapper.sumUserSince(command.userId(), now.minusDays(30)), amount,
                properties.getUserMonthlyLimitFen(), command, "USER_MONTHLY_LIMIT");
        requireWithin(reservationMapper.sumProjectSince(command.projectId(), now.minusHours(24)), amount,
                properties.getProjectDailyLimitFen(), command, "PROJECT_DAILY_LIMIT");

        CostReservation reservation = new CostReservation()
                .setGenerationJobId(command.generationJobId())
                .setUserId(command.userId())
                .setProjectId(command.projectId())
                .setActionIdentity(command.actionIdentity())
                .setActionType(command.actionType())
                .setProvider(command.quote().provider())
                .setReservedAmountFen(amount)
                .setStatus(CostReservationStatus.ACTIVE.name())
                .setPriceCatalogVersion(command.quote().priceCatalogVersion())
                .setExchangeRateVersion(command.quote().exchangeRateVersion())
                .setModelPolicyVersion(command.quote().modelPolicyVersion())
                .setCostRuleVersion(properties.getRuleVersion());
        reservationMapper.insert(reservation);
        auditRecordWriter.appendCostDecision(
                command, "cost_reservation.create", "allowed", "WITHIN_HARD_BUDGET",
                properties.getRuleVersion());
        return snapshot(reservation);
    }

    @Transactional(readOnly = true)
    public Optional<CostReservationSnapshot> findByJob(Long generationJobId) {
        return Optional.ofNullable(reservationMapper.selectByJob(generationJobId)).map(this::snapshot);
    }

    @Transactional
    public CostReservationSnapshot requireActiveBeforeProvider(Long generationJobId) {
        CostReservation reservation = reservationMapper.selectByJobForUpdate(generationJobId);
        if (reservation == null) {
            GenerationJob job = generationJobMapper.selectById(generationJobId);
            if (job != null) {
                auditRecordWriter.appendMissingReservationDenied(
                        job, "ACTIVE_RESERVATION_REQUIRED", properties.getRuleVersion());
            }
            throw GovernanceException.actionNotAllowed();
        }
        if (!CostReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            auditRecordWriter.appendDeniedProviderAdmission(
                    command(reservation), "ACTIVE_RESERVATION_REQUIRED",
                    properties.getRuleVersion());
            throw GovernanceException.actionNotAllowed();
        }
        return snapshot(reservation);
    }

    @Transactional
    public CostReservationSnapshot markPendingReconciliation(Long generationJobId, String reasonCode) {
        CostReservation reservation = requireReservation(generationJobId);
        return transition(reservation, CostReservationStatus.PENDING_RECONCILIATION, null,
                "cost_reservation.pending_reconciliation", reasonCode, "成本预留已终结");
    }

    @Transactional
    public CostReservationSnapshot settle(Long generationJobId, long actualAmountFen, String reasonCode) {
        CostReservation reservation = requireReservation(generationJobId);
        CostReservationStatus current = status(reservation);
        if (current == CostReservationStatus.SETTLED) {
            return snapshot(reservation);
        }
        if (actualAmountFen < 0 || actualAmountFen > reservation.getReservedAmountFen()) {
            throw new IllegalStateException("成本结算无效");
        }
        return transition(reservation, CostReservationStatus.SETTLED, actualAmountFen,
                "cost_reservation.settle", reasonCode, "成本结算无效");
    }

    @Transactional
    public CostReservationSnapshot settleReserved(Long generationJobId, String reasonCode) {
        CostReservation reservation = requireReservation(generationJobId);
        return transition(reservation, CostReservationStatus.SETTLED,
                reservation.getReservedAmountFen(), "cost_reservation.settle", reasonCode,
                "成本结算无效");
    }

    @Transactional
    public CostReservationSnapshot settlePendingReconciliation(
            Long generationJobId, String reasonCode) {
        CostReservation reservation = requireReservation(generationJobId);
        CostReservationStatus current = status(reservation);
        if (current == CostReservationStatus.SETTLED) {
            return snapshot(reservation);
        }
        if (current != CostReservationStatus.PENDING_RECONCILIATION) {
            throw new IllegalStateException("成本对账状态无效");
        }
        return transition(reservation, CostReservationStatus.SETTLED,
                reservation.getReservedAmountFen(), "cost_reservation.settle", reasonCode,
                "成本对账状态无效");
    }

    @Transactional
    public CostReservationSnapshot release(Long generationJobId, String reasonCode) {
        CostReservation reservation = requireReservation(generationJobId);
        return transition(reservation, CostReservationStatus.RELEASED, 0L,
                "cost_reservation.release", reasonCode, "成本释放无效");
    }

    @Transactional
    public void finalizeProviderFailure(Long generationJobId, boolean providerCallStarted) {
        if (providerCallStarted) {
            markPendingReconciliation(generationJobId, "PROVIDER_RESULT_UNKNOWN");
            return;
        }
        CostReservation reservation = reservationMapper.selectByJobForUpdate(generationJobId);
        if (reservation != null && status(reservation) == CostReservationStatus.ACTIVE) {
            transition(reservation, CostReservationStatus.RELEASED, 0L,
                    "cost_reservation.release", "PROVIDER_NOT_CALLED", "成本释放无效");
        }
    }

    @Transactional(readOnly = true)
    public BudgetEffect budgetEffect(Long generationJobId) {
        return findByJob(generationJobId)
                .map(CostReservationSnapshot::budgetEffect)
                .orElse(BudgetEffect.NONE);
    }

    private void requireValid(CostReservationCommand command) {
        if (command == null || command.userId() == null || command.projectId() == null
                || command.generationJobId() == null || command.actionIdentity() == null
                || command.actionIdentity().isBlank() || command.actionType() == null
                || command.actionType().isBlank() || command.quote() == null
                || command.quote().worstCaseFen() <= 0) {
            throw new IllegalArgumentException("成本预留参数无效");
        }
    }

    private boolean sameReservation(CostReservation reservation, CostReservationCommand command) {
        return Objects.equals(reservation.getUserId(), command.userId())
                && Objects.equals(reservation.getProjectId(), command.projectId())
                && Objects.equals(reservation.getActionIdentity(), command.actionIdentity())
                && Objects.equals(reservation.getActionType(), command.actionType())
                && Objects.equals(reservation.getProvider(), command.quote().provider())
                && Objects.equals(reservation.getReservedAmountFen(), command.quote().worstCaseFen())
                && Objects.equals(reservation.getPriceCatalogVersion(), command.quote().priceCatalogVersion())
                && Objects.equals(reservation.getExchangeRateVersion(), command.quote().exchangeRateVersion())
                && Objects.equals(reservation.getModelPolicyVersion(), command.quote().modelPolicyVersion());
    }

    private void lockBudgetScopes(CostReservationCommand command) {
        List<String> keys = List.of(
                "global",
                "provider:" + command.quote().provider(),
                "project:" + command.projectId(),
                "user:" + command.userId());
        keys.stream().sorted().forEach(key -> {
            budgetLockMapper.ensureExists(key);
            budgetLockMapper.lock(key);
        });
    }

    private void requireWithin(
            long current,
            long requested,
            long limit,
            CostReservationCommand command,
            String reasonCode) {
        if (limit <= 0 || current + requested > limit) {
            denyAndThrow(command, reasonCode);
        }
    }

    private void denyAndThrow(CostReservationCommand command, String reasonCode) {
        auditRecordWriter.appendDeniedCostDecision(command, reasonCode, properties.getRuleVersion());
        throw GovernanceException.quotaExceeded();
    }

    private CostReservation requireReservation(Long generationJobId) {
        CostReservation reservation = reservationMapper.selectByJobForUpdate(generationJobId);
        if (reservation == null) {
            throw new IllegalStateException("付费供应商调用缺少成本预留");
        }
        return reservation;
    }

    private void update(CostReservation reservation) {
        if (reservationMapper.updateById(reservation) != 1) {
            throw new IllegalStateException("成本预留状态已变化");
        }
    }

    private CostReservationSnapshot transition(
            CostReservation reservation,
            CostReservationStatus target,
            Long actualAmountFen,
            String action,
            String reasonCode,
            String invalidMessage) {
        CostReservationStatus current = status(reservation);
        if (current == target) {
            return snapshot(reservation);
        }
        if (!current.canTransitionTo(target)) {
            throw new IllegalStateException(invalidMessage);
        }
        reservation.setStatus(target.name()).setActualAmountFen(actualAmountFen);
        update(reservation);
        auditRecordWriter.appendReservationTransition(
                command(reservation), action, reasonCode, properties.getRuleVersion());
        return snapshot(reservation);
    }

    private CostReservationStatus status(CostReservation reservation) {
        return CostReservationStatus.valueOf(reservation.getStatus());
    }

    private CostReservationCommand command(CostReservation reservation) {
        return new CostReservationCommand(
                reservation.getUserId(), reservation.getProjectId(), reservation.getGenerationJobId(),
                reservation.getActionIdentity(), reservation.getActionType(),
                new PriceQuote(reservation.getReservedAmountFen(), reservation.getProvider(),
                        reservation.getPriceCatalogVersion(), reservation.getExchangeRateVersion(),
                        reservation.getModelPolicyVersion()));
    }

    private CostReservationSnapshot snapshot(CostReservation reservation) {
        CostReservationStatus status = status(reservation);
        return new CostReservationSnapshot(
                reservation.getId(), reservation.getGenerationJobId(), status, status.budgetEffect(),
                reservation.getReservedAmountFen(), reservation.getActualAmountFen(),
                reservation.getPriceCatalogVersion(), reservation.getExchangeRateVersion(),
                reservation.getModelPolicyVersion(), reservation.getCostRuleVersion());
    }
}
