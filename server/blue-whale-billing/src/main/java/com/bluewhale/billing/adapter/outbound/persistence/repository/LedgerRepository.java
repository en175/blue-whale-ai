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

/**
 * 复式账本的持久化（《计费逻辑详细设计》§2.2 / §3）。
 *
 * <p><b>append-only</b>：本仓库对外只有「插入」与「读」，没有更新与删除。
 * 冲正靠反向分录，不靠改历史——改历史会让「当时到底发生了什么」永久不可考。
 *
 * <p>SQL 在 {@link LedgerEntryMapper} 与 {@code resources/mapper/LedgerEntryMapper.xml}。
 */
@Repository
public class LedgerRepository {

    private final LedgerEntryMapper mapper;

    public LedgerRepository(LedgerEntryMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 这条凭证是否已记过 —— 重复请求的判据。
     *
     * <p>⚠️ 传的是**凭证基础键**（{@code hold:{commandId}}），不是分录键。
     * 分录的键是基础键加科目后缀（{@link Voucher#legKey}），所以这里按前缀找。
     * 直接拿基础键去等值匹配会**永远查不到**——判重静默失效，重复请求一路走到
     * 唯一索引上才炸，而那时事务里已经冻结过一遍钱了。
     *
     * <p>{@code likeRight} 生成 {@code LIKE 'base:%'}，值是绑定参数；因为带了分隔冒号，
     * {@code hold:cmd-6} 不会误匹配 {@code hold:cmd-60}。
     */
    public boolean existsByVoucherBase(String idempotencyBase) {
        return mapper.selectCount(new LambdaQueryWrapper<LedgerEntryEntity>()
                .likeRight(LedgerEntryEntity::getIdempotencyKey, idempotencyBase + ":")) > 0;
    }

    /**
     * 落一条凭证的全部分录，**逐笔计算 {@code balance_after}**。
     *
     * <p>为什么要加锁读上一笔：见 {@link LedgerEntryMapper#latestBalanceForUpdate}。
     *
     * <p>同一条凭证内的科目互不重复（{@link Voucher} 构造时强制），所以逐笔读上一笔即可，
     * 不会出现「本凭证前一腿刚写的余额还没读到」的问题。
     */
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

    /**
     * 该 (用户, 科目) 的当前余额（**只读，不加锁**）。
     *
     * <p>读的是**最近一笔分录的快照**，不是 SUM——两者在一致的历史下必然相等，
     * 但读快照能把「余额对不对」与「历史累计对不对」区分开：
     * 若某处断裂，快照会立刻显形，而 SUM 会把错误抹平。
     */
    public long balanceOf(long userId, Account account) {
        Long balance = mapper.latestBalance(userId, account.key());
        return balance == null ? 0L : balance;
    }

    /**
     * 沿该用户的 {@code balance_after} 走一遍，找出**快照断在哪一条分录上**
     * （《计费逻辑详细设计》§9 层次①的「按 balance_after 断裂点定位到具体分录」）。
     *
     * <h2>这一步在「按用户不平」之后才做</h2>
     *
     * 先由 {@code ReconciliationMapper.imbalancedUsers} 比出「谁的批次总量与账本余额不等」，
     * 再对**那几个用户**走链。反过来（对每个用户都走链）等于每天把整张账本表读进 JVM——
     * 那正是它被写成「只对不平用户执行」的理由。
     *
     * <h2>它区分两种截然不同的原因</h2>
     *
     * <ul>
     *   <li><b>有断裂</b>：某笔分录的 {@code balance_after} 与其前一笔对不上——
     *       账本被账本之外的写法改过（人工改数据、或写路径漏了「读上一笔」这一步）。
     *       断点就是那条分录，直接给出 id。</li>
     *   <li><b>无断裂</b>：账本自身自洽，差异只能来自**批次侧**——
     *       批次表被绕过账本直接改过（ADR-0115 决策 9 明文禁止的那件事）。
     *       这是两套完全不同的处置动作，日志必须把它们分开说。</li>
     * </ul>
     *
     * <h2>为什么只走最近 N 条</h2>
     *
     * 快照自洽性是**相邻两条之间**的性质，第 k 条只与第 k−1 条有关，不必从第 1 条读起。
     * 代价是更早的断裂看不到，所以 {@link BreakScan#windowFull()} 会明说窗口是否取满——
     * 不能让读日志的人把「窗口里没断」当成「历史上没断」。
     *
     * <p>⚠️ 只由每日自检调用，不在扣费路径上。
     *
     * @param limit 审计窗口（最多看最近多少条分录）
     */
    public BreakScan findBalanceBreaks(long userId, int limit) {
        List<LedgerEntryEntity> entries = mapper.listRecentForAudit(userId, limit);

        List<BreakPoint> breaks = new ArrayList<>();
        // 上一笔余额：按科目各记一份。缺省 0 与 balance_after 的起点一致
        // （第一笔的公式是 0 ± amount，见 LedgerRepository#insert）。
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
            // ⚠️ 用**实际值**而不是期望值作为下一笔的「上一笔」：账本里真实躺着的是它，
            //    后面那些分录也是照着它算出来的。用期望值续走会把一处断裂放大成
            //    之后每一笔都报断裂，真正的断点反而淹在噪声里。
            previous.put(entry.getAccount(), entry.getBalanceAfter());
        }
        return new BreakScan(breaks, entries.size() >= limit);
    }

    private static LedgerEntry.Direction directionOf(LedgerEntryEntity entry) {
        // 库里存的是小写（见 insert），枚举是大写——转换只此一处
        return LedgerEntry.Direction.valueOf(entry.getDirection().toUpperCase(Locale.ROOT));
    }

    /**
     * 走链的结果。
     *
     * @param breaks    断裂点（按科目分组走链时发现的每一处；正常账本为空）
     * @param windowFull 窗口是否取满 —— 为 true 时「没断裂」只代表**窗口内**没断裂
     */
    public record BreakScan(List<BreakPoint> breaks, boolean windowFull) {
    }

    /**
     * 一处 {@code balance_after} 断裂。
     *
     * @param entryId         断裂落在哪条分录上（人工排查的入口）
     * @param account         科目
     * @param previousBalance 同一科目的上一笔余额
     * @param expectedBalance 按「上一笔 + 本笔有符号增减」应有的值
     * @param actualBalance   库里实际写的值
     */
    public record BreakPoint(long entryId, String account, long previousBalance,
                             long expectedBalance, long actualBalance) {
    }
}
