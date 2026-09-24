package com.bluewhale.billing.ledger;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.domain.entity.LedgerEntryEntity;
import com.bluewhale.billing.infrastructure.mapper.LedgerEntryMapper;
import org.springframework.stereotype.Repository;

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
}
