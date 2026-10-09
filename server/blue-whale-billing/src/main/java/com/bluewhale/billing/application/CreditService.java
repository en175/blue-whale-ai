package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.domain.ledger.Account;
import org.slf4j.Logger;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.BizType;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.ledger.Voucher;
import com.bluewhale.billing.domain.ledger.Reservation;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CreditService {

    private static final Logger log = LoggerFactory.getLogger(CreditService.class);

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
    public HoldResult hold(long userId, String commandId, long jobId,
                           long amount, int catalogVersion, int discountBp,
                           String ruleSnapshot, String title) {

        String idempotencyKey = "hold:" + commandId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return reservations.findByJobId(jobId)
                    .map(r -> HoldResult.replay(r.reservedCredits(), r.catalogVersion()))
                    .orElseThrow(() -> new IllegalStateException(
                            "幂等键已存在但找不到对应预留：jobId=" + jobId));
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("预扣额必须为正：" + amount);
        }
        if (discountBp <= 0 || discountBp > 10_000) {
            throw new IllegalArgumentException("折扣系数必须在 1..10000 之间：" + discountBp);
        }

        List<CreditLotRepository.Lot> active = lots.lockActiveLots(userId);

        long available = active.stream().mapToLong(CreditLotRepository.Lot::available).sum();
        if (available < amount) {
            throw new InsufficientCreditsException(available, amount);
        }

        long rest = amount;
        List<Allocation> allocations = new ArrayList<>();
        for (CreditLotRepository.Lot lot : active) {
            if (rest == 0) {
                break;
            }
            long take = Math.min(lot.available(), rest);
            if (take <= 0) {
                continue;
            }
            lots.addFrozen(lot.id(), take);
            allocations.add(new Allocation(lot.id(), take));
            rest -= take;
        }
        if (rest != 0) {
            throw new IllegalStateException("冻结金额不足，剩余 " + rest + "（可用 " + available + "，需 " + amount + "）");
        }

        reservations.insert(jobId, userId, amount, catalogVersion, discountBp,
                ruleSnapshot, title, allocations);

        ledger.insert(Voucher.base(idempotencyKey, userId, BizType.HOLD, String.valueOf(jobId))
                .debit(Account.WALLET, amount, "提交预扣")
                .credit(Account.FROZEN, amount, "提交预扣")
                .build());

        return HoldResult.fresh(amount, catalogVersion);
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
    public void settle(long jobId, long actualCredits) {

        String idempotencyKey = "settle:" + jobId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return;
        }
        if (actualCredits < 0) {
            throw new IllegalArgumentException("实际消耗不能为负：" + actualCredits);
        }

        Reservation reservation = reservations.lockByJobId(jobId);
        if (reservation == null || !reservation.isPending()) {
            return;
        }

        long reserved = reservation.reservedCredits();
        long consumed = Math.min(actualCredits, reserved);

        long receivable = actualCredits - consumed;

        Map<Long, Long> actualByLot = new LinkedHashMap<>();
        List<Allocation> settled = new ArrayList<>();
        long rest = consumed;
        for (Allocation allocation : reservation.allocations()) {
            long take = Math.min(allocation.take(), rest);
            rest -= take;
            actualByLot.put(allocation.lotId(), take);
            if (take > 0) {
                settled.add(new Allocation(allocation.lotId(), take));
            }
        }

        for (Allocation allocation : reservation.allocations()) {
            lots.settle(allocation.lotId(), allocation.take(),
                    actualByLot.getOrDefault(allocation.lotId(), 0L));
        }

        Map<Account, Long> consumedByAccount = new LinkedHashMap<>();
        Account marginalAccount = Account.REVENUE;
        for (Allocation allocation : settled) {
            marginalAccount = lots.sourceOf(allocation.lotId()).consumptionAccount();
            consumedByAccount.merge(marginalAccount, allocation.take(), Long::sum);
        }
        if (rest > 0) {
            consumedByAccount.merge(marginalAccount, rest, Long::sum);
            log.warn("结算超出预扣：jobId={} 预扣={} 实际={} 多出={} —— 预扣阶段可能漏算了计价维度",
                    jobId, reserved, actualCredits, rest);
        }

        if (receivable > 0) {
            consumedByAccount.merge(marginalAccount, receivable, Long::sum);
            log.warn("结算超出预扣：jobId={} 预扣={} 实际={} 欠费={} —— "
                            + "这笔差额记应收、先记着不收（产品口径：欠费只记录不追收）；"
                            + "按 token 估的预扣偏低是预期内的（估算 vs 上游真值），"
                            + "若某个模型长期单向偏高，多半是它的估算参数该调了",
                    jobId, reserved, actualCredits, receivable);
        }

        Voucher.Builder voucher = Voucher.base(idempotencyKey, reservation.userId(),
                BizType.SETTLE, String.valueOf(jobId));
        voucher.debit(Account.FROZEN, reserved, "结算解冻");
        consumedByAccount.forEach((account, amount) -> voucher.credit(account, amount, "实际消耗"));

        long refund = reserved - actualCredits;
        if (refund > 0) {
            voucher.credit(Account.WALLET, refund, "差额回可用余额");
        } else if (refund < 0) {
            voucher.debit(Account.RECEIVABLE, receivable, "超扣转应收");
        }
        ledger.insert(voucher.build());

        reservations.markSettled(jobId, actualCredits, receivable);
    }

    @Transactional
    public void refund(long jobId, String reason) {

        String idempotencyKey = "refund:" + jobId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            return;
        }

        Reservation reservation = reservations.lockByJobId(jobId);
        if (reservation == null || !reservation.isPending()) {
            return;
        }

        for (Allocation allocation : reservation.allocations()) {
            lots.releaseFrozen(allocation.lotId(), allocation.take());
        }

        ledger.insert(Voucher.base(idempotencyKey, reservation.userId(),
                        BizType.REFUND, String.valueOf(jobId))
                .debit(Account.FROZEN, reservation.reservedCredits(), "释放冻结")
                .credit(Account.WALLET, reservation.reservedCredits(), "任务失败返还")
                .build());

        reservations.markReleased(jobId, reason);
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
        long amount = lot.available();
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
