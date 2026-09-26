package com.bluewhale.billing.ledger;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 积分账户的写操作入口 —— 预扣 / 结算 / 返还（《计费逻辑详细设计》§4.2 – §4.4）。
 *
 * <h2>为什么是「预扣」而不是「直接扣」</h2>
 *
 * 生成任务是异步且可能失败的：提交时不知道最终消耗多少（拆镜头后可能只成功一部分），
 * 甚至可能一分钱都不花。若提交时就扣掉，失败后要退款——用户会看到「扣了 40 又退 10」
 * 两条记录，还得理解「预扣」这个词。
 *
 * <p>预扣把这段不确定性做成**用户不可见**的：钱在提交时被冻结（不能再用，但还在），
 * 完成时按实际消耗结算，失败时原样解冻。用户只看到一行
 * 「处理中 · 预计消耗 40」变成「已完成 · 消耗 30」。
 *
 * <h2>三个方法都在一个事务里</h2>
 *
 * 批次冻结、预留写库、账本记账必须同生共死。任一失败整体回滚——
 * 最怕的中间态是「冻结了但没记账」：钱少了却查不出原因，人工只能猜。
 *
 * <h2>幂等</h2>
 *
 * 每个方法进来先查幂等键。**但真正的保证在唯一索引上**，不在这次查询——
 * 查询只是让重放走「返回首次结果」的快路径；两个并发请求同时通过查询时，
 * 唯一索引会拦下后到的那个（抛 {@code DuplicateKeyException}，事务回滚）。
 * 应用层判重有 TOCTOU 窗口，唯一索引没有。
 */
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

    /**
     * 预扣。幂等键 {@code hold:{commandId}}。
     *
     * <p>余额不足抛 {@link InsufficientCreditsException}（上层映射 402），**不创建 job**。
     *
     * @param commandId      客户端生成的命令 id —— 幂等键来自它而不是 jobId：
     *                       重试发生在 job 创建**之前**，那时还没有 jobId 可用
     * @param amount         预扣额（积分）
     * @param catalogVersion 本次计价用的目录版本
     * @param discountBp     本次计价命中的折扣系数（万分比，10000 = 原价）。
     *                       与 catalogVersion 一起冻进预留——**结算时按它复现，不重新解析**，
     *                       否则「提交后被停掉的营销活动」会让结算按原价扣
     * @param title          展示文案快照，随预留一起存下来供用户流水展示（见 V6 迁移）。
     *                       预扣是唯一同时见到「这次任务是什么」与「预留行」的一刻
     * @param ruleSnapshot   本次计价用的**规则本身**（JSON 文本，见 V8 迁移）。
     *                       它是结算复现定价的**唯一**来源（规则住在模型能力行，billing 读不到
     *                       那个库），所以必须与 catalogVersion / discountBp 一起冻进预留
     */
    @Transactional
    public HoldResult hold(long userId, String commandId, long jobId,
                           long amount, int catalogVersion, int discountBp,
                           String ruleSnapshot, String title) {

        String idempotencyKey = "hold:" + commandId;
        if (ledger.existsByVoucherBase(idempotencyKey)) {
            // 重复提交：返回首次结果，绝不二次冻结
            return reservations.findByJobId(jobId)
                    .map(r -> HoldResult.replay(r.reservedCredits(), r.catalogVersion()))
                    .orElseThrow(() -> new IllegalStateException(
                            "幂等键已存在但找不到对应预留：jobId=" + jobId));
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("预扣额必须为正：" + amount);
        }
        if (discountBp <= 0 || discountBp > 10_000) {
            // 折扣可以到 0（白送）吗？不行——那意味着这个模型不该配价格，而不是配 0 折扣。
            // 上界 10000 是因为加价不该由「折扣」表达（那是 multipliers 的事）。
            throw new IllegalArgumentException("折扣系数必须在 1..10000 之间：" + discountBp);
        }

        // ── 锁该用户的全部有效批次，返回时已按扣减顺序排好（§4.1 的三级 tie-break）
        List<CreditLotRepository.Lot> active = lots.lockActiveLots(userId);

        long available = active.stream().mapToLong(CreditLotRepository.Lot::available).sum();
        if (available < amount) {
            throw new InsufficientCreditsException(available, amount);
        }

        // ── 按顺序冻结，直到凑够
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
            // 上面已确认 available >= amount，走到这里说明冻结逻辑漏了一部分。
            // 抛异常回滚，而不是带着「冻结不足」的记录继续——后者结算时必然对不上账。
            throw new IllegalStateException("冻结金额不足，剩余 " + rest + "（可用 " + available + "，需 " + amount + "）");
        }

        reservations.insert(jobId, userId, amount, catalogVersion, discountBp,
                ruleSnapshot, title, allocations);

        // 复式分录（§3 分录 5）：钱从「可用」转为「受限」，两边都要记
        ledger.insert(Voucher.base(idempotencyKey, userId, BizType.HOLD, String.valueOf(jobId))
                .debit(Account.WALLET, amount, "提交预扣")
                .credit(Account.FROZEN, amount, "提交预扣")
                .build());

        return HoldResult.fresh(amount, catalogVersion);
    }

    /**
     * 发放一批积分。幂等键 {@code grant:{grantKey}}。
     *
     * <p><b>不做事前判重</b>：批次表 {@code uk_lots__grant_key} 与账本 {@code uk_ledger__idem}
     * 两道唯一索引都拦得住。重复调用会抛 {@code DuplicateKeyException} 并整体回滚——
     * 这正是想要的：发放是「要么记一次，要么一次都没有」，没有中间态。
     *
     * <p>⚠️ 本方法只管**记账本身**。每种来源的有效期策略（每日 23:59 过期 / 充值赠送 30 天 /
     * 注册赠送永久）、以及「每日登录只能领一次」这类业务规则，属于发放策略，另行落地。
     *
     * @param expiresAt 批次有效期；<b>null = 永久</b>
     * @param grantKey  发放幂等键（{@code register:{userId}} / {@code daily:{userId}:{date}} …）
     * @return 新建批次的 id
     */
    @Transactional
    public long grant(long userId, CreditSource source, long amount, Instant expiresAt,
                      String bizType, String bizId, String grantKey) {
        if (amount <= 0) {
            throw new IllegalArgumentException("发放量必须为正：" + amount);
        }
        long lotId = lots.grant(userId, source, amount, expiresAt, bizType, bizId, grantKey);

        // 复式分录（§3 分录 3）：发放是平台成本，用户余额同时增加
        ledger.insert(Voucher.base("grant:" + grantKey, userId, BizType.GRANT, bizId)
                .debit(Account.COST, amount, "积分发放")
                .credit(Account.WALLET, amount, "积分发放")
                .build());

        return lotId;
    }

    /**
     * 结算。幂等键 {@code settle:{jobId}}。
     *
     * <p>按预扣时**同一份分配明细**扣减实际额：先解冻全部冻结量，再从各批次扣掉实际用量，
     * 差额自动回到可用余额。**不重算分配**——期间可能插入了新批次或旧批次过期，
     * 重算会扣到别的批次上。
     *
     * <h2>三个金额，以及它们各自的去向</h2>
     * <pre>
     *   使用 = actualCredits          真实用量成本（**不是**用户被扣走的）
     *   实扣 = min(actual, reserved)   用户余额里真正少了多少 = 预扣额（不悄悄多扣）
     *   欠费 = actual − 实扣          差额，平台先垫、用户后欠
     * </pre>
     * 欠费那一笔同时落在三处、且取同一个变量：预留行的 {@code receivable_credits} 列
     * （见 V9 迁移，管理端据此可见）、账本「借 {@code RECEIVABLE}」那一腿、以及下面那条 WARN。
     *
     * <p>⚠️ <b>{@code RECEIVABLE} 的符号约定</b>：它的自然方向是<b>借</b>
     * （{@link Account#RECEIVABLE} 的 {@code normalDebit=true}），而超扣走的正是
     * <b>借</b>方，所以 {@code ledger.balanceOf(userId, RECEIVABLE)} 读出来就是
     * <b>正数 = 该用户欠多少</b>，不需要取绝对值。反向（贷应收）只会在将来真收到钱时才出现。
     *
     * @param actualCredits 实际消耗（积分）。{@code > 预扣} 分两种情形，处理相同
     *                      （差额记应收并告警，**不悄悄多扣用户**）：
     *                      <ul>
     *                        <li><b>按 token 计价的模型</b>（视频）：预扣是**估算**（按官方公式
     *                            猜 token），真实用量由上游返回 —— 估算偏低是<b>正常</b>的
     *                            （实测 480p 16:9 5s：估算 48,600 / 上游实报 50,638，
     *                            差额来自官方公式未含的音频）。这类超出有界且可预期。</li>
     *                        <li>其余按上限冻结的模型：真发生说明定价漏算了维度。</li>
     *                      </ul>
     */
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
            // 不存在（任务未走预扣）或已结算/已释放 —— 都是无操作，不是错误。
            // 结算与超时兜底扫描会并发到达，第二条必然走这里。
            return;
        }

        long reserved = reservation.reservedCredits();
        long consumed = Math.min(actualCredits, reserved);

        // ★ 欠费额 —— 这次真实用量里**没能从用户余额收到**的那部分（= 实际 − 预扣，负数归零）。
        //   它有三个落点，而且**必须是同一个数**：
        //     ① 预留行的 receivable_credits 列（下面 markSettled 一把写下，管理端按它看得见欠费）
        //     ② 账本「借 RECEIVABLE」那一腿（复式分录的另一半）
        //     ③ 下面那条 WARN 报出的「欠费」
        //   此前这三处没有共同来源：列里根本没有这一项、账本腿只在分录里、日志只说「多出多少」，
        //   于是「用户欠了多少钱」全仓没有任何一处读得出来——口径之争就是这么来的。
        //   所以只在这里算一次，往下全是引用。
        long receivable = actualCredits - consumed;

        // ── 把实际消耗按**同一顺序**铺回各批次；剩余部分（若实际 > 预扣）走应收
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
            // 解冻整笔分配量，只从 remaining 扣实际用量 —— 差额留在批次里变回可用
            lots.settle(allocation.lotId(), allocation.take(),
                    actualByLot.getOrDefault(allocation.lotId(), 0L));
        }

        // ── 消耗记收入还是成本，**按批次来源逐笔判定**，不能整单一个科目（§3 注）
        Map<Account, Long> consumedByAccount = new LinkedHashMap<>();
        Account marginalAccount = Account.REVENUE;
        for (Allocation allocation : settled) {
            marginalAccount = lots.sourceOf(allocation.lotId()).consumptionAccount();
            consumedByAccount.merge(marginalAccount, allocation.take(), Long::sum);
        }
        if (rest > 0) {
            // 实际 > 预扣。超出的部分会继续沿扣减顺序吃下一批，但那时没有分配明细可查，
            // 只能挂在「最后一个被吃到的批次」的科目上——这个近似只在漏算维度时出现。
            consumedByAccount.merge(marginalAccount, rest, Long::sum);
            log.warn("结算超出预扣：jobId={} 预扣={} 实际={} 多出={} —— 预扣阶段可能漏算了计价维度",
                    jobId, reserved, actualCredits, rest);
        }

        // ── 超出预扣的部分：**贷消耗科目**（收入照记）──────
        // 它下面由 refund<0 那支以「借应收」配对，两边必须同时出现，否则分录不平（曾经
        // 借 actual / 贷 reserved），整笔结算抛 IllegalArgumentException 并被 MQ 无限重投，
        // 用户的钱永远冻着 —— 线上实测（jobId=1924：预扣 27 / 实际 28）。
        //
        // 为什么计入收入而不是少记：那是平台先垫、用户后欠（应收），金额本身是真的。
        if (receivable > 0) {
            consumedByAccount.merge(marginalAccount, receivable, Long::sum);
            // ⚠️ 这条日志就是**欠费信号**：产品已确认走「先欠费」——只记录、只可见，
            //    不收款、不封禁、不拦截。所以这里不动作，只把「欠了多少」报清楚，
            //    并让 jobId 成为从日志走到预留行 / 账本那一笔的入口。
            log.warn("结算超出预扣：jobId={} 预扣={} 实际={} 欠费={} —— "
                            + "这笔差额记应收、先记着不收（产品口径：欠费只记录不追收）；"
                            + "按 token 估的预扣偏低是预期内的（估算 vs 上游真值），"
                            + "若某个模型长期单向偏高，多半是它的估算参数该调了",
                    jobId, reserved, actualCredits, receivable);
        }

        // ── 复式分录（§3 分录 6/7/8）
        Voucher.Builder voucher = Voucher.base(idempotencyKey, reservation.userId(),
                BizType.SETTLE, String.valueOf(jobId));
        voucher.debit(Account.FROZEN, reserved, "结算解冻");
        consumedByAccount.forEach((account, amount) -> voucher.credit(account, amount, "实际消耗"));

        long refund = reserved - actualCredits;
        if (refund > 0) {
            // 实际 < 预扣：差额解冻回钱包。用户可见层面这不产生「退款」记录，
            // 只体现为「预计消耗 40」变成「消耗 30」
            voucher.credit(Account.WALLET, refund, "差额回可用余额");
        } else if (refund < 0) {
            // refund < 0 ⟺ receivable > 0 —— 同一个差额的两种说法，金额取上面那个共同来源，
            // 保证账本这一腿与预留行的 receivable_credits 列**逐笔相等**（可对账）
            voucher.debit(Account.RECEIVABLE, receivable, "超扣转应收");
        }
        ledger.insert(voucher.build());

        // 欠费额与账本那一腿同一个数、同一次结算落库（见 markSettled 的说明）
        reservations.markSettled(jobId, actualCredits, receivable);
    }

    /**
     * 全额返还（任务失败）。幂等键 {@code refund:{jobId}}。
     *
     * <p><b>只解冻，不动 remaining，也不新建批次</b>：批次连同它的 {@code expires_at}
     * 原封不动地回到可用状态。若改成「扣掉再新建一个批次返回」，用户会凭空获得一次
     * 有效期重置——那部分多出来的时间不是他应得的权益。
     */
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
}
