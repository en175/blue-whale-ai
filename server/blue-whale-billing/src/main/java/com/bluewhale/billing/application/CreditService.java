package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.BizType;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.ledger.Voucher;
import com.bluewhale.billing.domain.ledger.Reservation;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CreditService {

    private final CreditLotRepository lots;
    private final LedgerRepository ledger;
    private final ReservationRepository reservations;

    public CreditService(CreditLotRepository lots,
                         LedgerRepository ledger,
                         ReservationRepository reservations) {
        this.lots = lots;
        this.ledger = ledger;
        this.reservations = reservations;
    }

    @Transactional
    public ChargeResult charge(long userId, String commandId, long jobId,
                               long amount, int catalogVersion, int discountBp,
                               String ruleSnapshot, String title) {

        String idempotencyKey = "charge:" + jobId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return reservations.findByJobId(jobId)
                    .map(r -> ChargeResult.replay(r.chargedCredits(), r.catalogVersion()))
                    .orElseThrow(() -> new IllegalStateException(
                            "幂等键已存在但找不到对应扣款：jobId=" + jobId));
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("扣款额必须为正：" + amount);
        }
        if (discountBp <= 0 || discountBp > 10_000) {
            throw new IllegalArgumentException("折扣系数必须在 1..10000 之间：" + discountBp);
        }

        List<CreditLotRepository.Lot> active = lots.lockActiveLots(userId);

        long available = active.stream().mapToLong(CreditLotRepository.Lot::remaining).sum();
        if (available < amount) {
            throw new InsufficientCreditsException(available, amount);
        }

        long rest = amount;
        List<Allocation> allocations = new ArrayList<>();
        for (CreditLotRepository.Lot lot : active) {
            if (rest == 0) {
                break;
            }
            long take = Math.min(lot.remaining(), rest);
            if (take <= 0) {
                continue;
            }
            lots.consume(lot.id(), take);
            allocations.add(new Allocation(lot.id(), take));
            rest -= take;
        }
        if (rest != 0) {
            throw new IllegalStateException("扣款金额不足，剩余 " + rest + "（可用 " + available + "，需 " + amount + "）");
        }

        reservations.insert(jobId, userId, amount, catalogVersion, discountBp,
                ruleSnapshot, title, allocations);

        Map<Account, Long> consumedByAccount = new LinkedHashMap<>();
        for (Allocation allocation : allocations) {
            consumedByAccount.merge(lots.sourceOf(allocation.lotId()).consumptionAccount(),
                    allocation.take(), Long::sum);
        }

        Voucher.Builder voucher = Voucher.base(idempotencyKey, userId,
                BizType.CHARGE, String.valueOf(jobId));
        voucher.debit(Account.WALLET, amount, "提交扣款");
        consumedByAccount.forEach((account, taken) -> voucher.credit(account, taken, "提交扣款"));
        ledger.insert(voucher.build());

        return ChargeResult.fresh(amount, catalogVersion);
    }

    @Transactional
    public long grant(long userId, CreditSource source, long amount, LocalDateTime expiresAt,
                      String bizType, String bizId, String grantKey) {
        if (amount <= 0) {
            throw new IllegalArgumentException("发放量必须为正：" + amount);
        }
        long lotId = lots.grant(userId, source, amount, expiresAt, bizType, bizId, grantKey);

        ledger.insert(Voucher.base("grant:" + grantKey, userId, BizType.GRANT, bizId)
                .debit(Account.COST, amount, "积分发放")
                .credit(Account.WALLET, amount, "积分发放")
                .build());

        return lotId;
    }

    @Transactional
    public void refund(long jobId, String reason) {

        String idempotencyKey = "refund:" + jobId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return;
        }

        Reservation reservation = reservations.lockByJobId(jobId);
        if (reservation == null || !reservation.isCharged()) {
            return;
        }

        List<Allocation> allocations = reservation.allocations();
        for (Allocation allocation : allocations) {
            lots.restore(allocation.lotId(), allocation.take());
        }

        Map<Account, Long> consumedByAccount = new LinkedHashMap<>();
        for (Allocation allocation : allocations) {
            consumedByAccount.merge(lots.sourceOf(allocation.lotId()).consumptionAccount(),
                    allocation.take(), Long::sum);
        }

        Voucher.Builder voucher = Voucher.base(idempotencyKey, reservation.userId(),
                BizType.REFUND, String.valueOf(jobId));
        voucher.credit(Account.WALLET, reservation.chargedCredits(), "任务失败返还");
        consumedByAccount.forEach((account, taken) -> voucher.debit(account, taken, "任务失败返还"));
        ledger.insert(voucher.build());

        reservations.markRefunded(jobId, reason);
    }

    @Transactional
    public long expireLot(long lotId) {
        CreditLotRepository.Lot lot = lots.lockById(lotId);
        if (lot == null) {
            return 0;
        }
        if (lot.expiresAt() == null || lot.expiresAt().isAfter(LocalDateTime.now())) {
            return 0;
        }
        long amount = lot.remaining();
        if (amount <= 0) {
            return 0;
        }
        String idempotencyKey = "expire:" + lotId + ":" + lot.version();
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return 0;
        }

        lots.expire(lotId, amount);

        ledger.insert(Voucher.base(idempotencyKey, lot.userId(), BizType.EXPIRE, String.valueOf(lotId))
                .debit(Account.WALLET, amount, "积分过期核销")
                .credit(Account.COST, amount, "积分过期核销")
                .build());

        return amount;
    }
}
