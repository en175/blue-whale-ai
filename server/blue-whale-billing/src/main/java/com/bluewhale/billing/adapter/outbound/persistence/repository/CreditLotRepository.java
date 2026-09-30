package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.bluewhale.billing.domain.DbTime;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CreditLotEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.CreditLotMapper;
import com.bluewhale.billing.adapter.outbound.persistence.row.UserAmountRow;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 积分批次的持久化（《计费逻辑详细设计》§7.2）。
 *
 * <p><b>批次是余额的唯一权威</b>——不设物化余额表。两处状态必然有不一致风险，
 * 而对账时无法判断谁对；直接从批次聚合（{@link #availableCredits}）只需一次索引扫描。
 *
 * <p>本类只管**行 ↔ 领域对象的搬运与转换**；SQL 在
 * {@link CreditLotMapper} 与 {@code resources/mapper/CreditLotMapper.xml}。
 * 拆开的理由：SQL 的读者是「要改查询、看索引、查执行计划」的人，
 * Java 的读者是「要改业务规则」的人，两者改动的时机与评审标准都不同。
 */
@Repository
public class CreditLotRepository {

    private final CreditLotMapper mapper;

    public CreditLotRepository(CreditLotMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 批次（读模型）。
     *
     * @param version 行的版本号，由每次写入自增。它是**过期核销幂等键**的一部分：
     *                同一批次可能被核销不止一次（冻结部分解冻回可用后再次到期），
     *                而版本号是做一次写就变一次的单调量，天然能区分两次核销。
     * @see #lockById(long)
     */
    public record Lot(long id, long userId, CreditSource source, long amount,
                      long remaining, long frozen, Instant expiresAt, int version) {
        public long available() {
            return remaining - frozen;
        }
    }

    /**
     * ★ **锁该用户的全部有效批次**，按扣减顺序排好序返回。
     *
     * <p>三级 tie-break 与 {@code FOR UPDATE} 的语义见 {@link CreditLotMapper#lockActiveLots}。
     */
    public List<Lot> lockActiveLots(long userId) {
        return mapper.lockActiveLots(userId).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /**
     * 按主键读一行并**锁住它**（过期核销用）。
     *
     * <p>与 {@link #lockActiveLots} 的差别是**不筛有效期**：核销正要看的就是已过期的那一行。
     *
     * @return 不存在时 {@code null}
     */
    public Lot lockById(long lotId) {
        CreditLotEntity entity = mapper.lockById(lotId);
        return entity == null ? null : toLot(entity);
    }

    /**
     * 已到期、仍有可核销量的批次（跨全部用户，最久到期的在前）。
     *
     * @param limit 本轮最多取几条
     */
    public List<Lot> listDueLots(int limit) {
        return mapper.listDueLots(limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /**
     * 按发放幂等键查**已经发出去那一笔的 `biz_id`**（即「是谁发的」）。
     *
     * <p>为什么需要它：幂等键撞车（409）只告诉调用方「这个键已经用过了」，而调用方往往
     * 需要区分「<b>我自己</b>之前发过」与「<b>别人</b>先占了」。这两件事在业务上完全不同——
     * 前者是「我这一单已经发了」，后者是「这一单不该发」。只有这个键的**归属**能分辨。
     *
     * <p>撞车发生在**别处**（比如账本那条唯一索引）时键不存在于批次表，返回 {@code null}——
     * 调用方拿不到归属时应当如实说「不知道」，不要猜。
     *
     * @param grantKey 发放幂等键
     * @return 该键对应批次的 {@code biz_id}；键不存在时 {@code null}
     */
    public String findBizIdByGrantKey(String grantKey) {
        CreditLotEntity entity = mapper.selectOne(new LambdaQueryWrapper<CreditLotEntity>()
                .eq(CreditLotEntity::getGrantKey, grantKey)
                .select(CreditLotEntity::getBizId));
        return entity == null ? null : entity.getBizId();
    }

    /** 可用余额 = Σ(remaining − frozen)，仅计未过期的批次。 */
    public long availableCredits(long userId) {
        return mapper.sumAvailable(userId);
    }

    /**
     * **一批用户**的可用余额（管理端用户列表那一列）。
     *
     * <p>与 {@link #availableCredits} 是同一条 WHERE 的批量投影（只多一个 {@code user_id IN}）
     * —— 列表页与详情页显示的必须是同一个数，理由见
     * {@link CreditLotMapper#sumAvailableByUser}。
     *
     * @param userIds 非空。空集合会拼出 {@code IN ()} 语法错，本层不兜底
     * @return 只含**确有批次**的用户；没有批次的用户不在表里（调用方按 0 处理）
     */
    public Map<Long, Long> availableCreditsOf(List<Long> userIds) {
        return UserAmountRow.toMap(mapper.sumAvailableByUser(userIds));
    }

    /**
     * **一批用户**的「某来源发放合计」（管理端用户列表的「累计充值」列）。
     *
     * <p>⚠️ 累计充值传 {@link CreditSource#PURCHASED}：**只算充值本金**，不含充值赠送
     * （赠送是 {@code bonus} 批次）—— 这一列问的是用户自己充了多少钱，
     * 把赠送折进去运营就拿这个数对不上营收了。理由见
     * {@link CreditLotMapper#sumGrantedByUser}。
     *
     * @return 只含**该来源确有批次**的用户；其余用户不在表里（调用方按 0 处理）
     */
    public Map<Long, Long> grantedCreditsOf(List<Long> userIds, CreditSource source) {
        return UserAmountRow.toMap(mapper.sumGrantedByUser(userIds, source.key()));
    }

    /**
     * 可用余额按来源拆开（用户界面「总积分 = 各类型之和」）。
     *
     * <p>与 {@link #availableCredits} 是**同一条 SQL 的两种投影**：谓词逐字相同，
     * 只多一个 {@code GROUP BY source}。所以两者的和必然相等——调用方若发现不等，
     * 那是有人把其中一处的 WHERE 改单边了，不是取整或口径差异。
     *
     * <p>来源用 {@link CreditSource} 承载而不是裸 {@code String}：库里出现枚举外的值时
     * 要在**这里**就炸（{@code CreditSource.of} 抛 {@code IllegalArgumentException}），
     * 而不是让它一路漂到界面上变成一个没人认识的中文标签。
     */
    public List<SourceAvailable> availableCreditsBySource(long userId) {
        return mapper.sumAvailableBySource(userId).stream()
                .map(row -> new SourceAvailable(CreditSource.of(row.getSource()),
                        row.getCredits() == null ? 0L : row.getCredits()))
                .toList();
    }

    /**
     * 一个来源的可用积分。
     *
     * @param source  批次来源
     * @param credits 该类可用积分 Σ(remaining − frozen)；全被冻结时为 0
     */
    public record SourceAvailable(CreditSource source, long credits) {}

    /**
     * 用户台账里的一行（积分明细「已获取」的展示模型）。
     *
     * <p>与 {@link Lot} 的区别：`Lot` 是**扣减用的**读模型（只有 id/source/额度/到期），
     * 而这一行是**给人看的** —— 要带发放时刻（「获取时间」）、业务归属（「获取详情」里的
     * 订单号），而且 `remaining` 的口径也不同（见下）。
     *
     * @param id        批次 id
     * @param source    批次来源（**批次口径**：`purchased`，不是流水口径的 `recharge`）
     * @param amount    发放时的原始积分
     * @param remaining **可用量** = `remaining − frozen`，不是表里那个 `remaining`。
     *                  冻结中的部分已经许给在途任务了，对用户来说「不能用」，不该算进
     *                  「这笔还剩多少」。这与 `available_credits` / `by_source` 用同一个口径
     *                  （那两处也是 `remaining − frozen`），三个数才能对得上。
     * @param expiresAt 到期时刻；**null = 永久有效**（表里这一列可为空）
     * @param bizType   业务类型（recharge / …）；无关联时为空串
     * @param bizId     关联单号（充值批次 = 订单号）；无关联时为空串
     */
    public record UserLot(long id, CreditSource source, long amount, long remaining,
                          Instant createdAt, Instant expiresAt,
                          String bizType, String bizId) {}

    /**
     * 台账的一页。
     *
     * @param items 本页的行，按发放时间倒序
     * @param total 该用户**全部**批次条数（不是本页条数）
     */
    public record UserLotPage(List<UserLot> items, long total) {
        public UserLotPage {
            items = List.copyOf(items);
        }
    }

    /**
     * 用户台账一页（积分明细「已获取」）。
     *
     * <p>⚠️ **列的是全部批次**，不筛有效期、不筛剩余量：用光了的、已过期的批次同样要出现。
     * 少了它们，「我已获取」就成了一份会自己缩短的清单 —— 与流水里「released 行凭空消失」
     * 是同一类问题（见 {@code TransactionMapper.xml} 里那段 ★）。
     *
     * @param userId 必填。这是用户侧取数，0 只会得到空页，不会得到别人的账
     * @param size   本页条数（上限由应用层钳制）
     * @param page   页码，从 1 起；{@code < 1} 夹到 1（负 OFFSET 会让 MySQL 语法错）
     */
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
                // 可用量，不是表里那个 remaining —— 冻结部分对用户已经「不能用」了
                remaining - frozen,
                DbTime.fromDb(entity.getGmtCreate()),
                DbTime.fromDb(entity.getExpiresAt()),
                // NULL → 空串：proto3 的 string 没有 null，空串是唯一的「没有」。
                // 在这里收敛成一种，上层就不必判两种空
                entity.getBizType() == null ? "" : entity.getBizType(),
                entity.getBizId() == null ? "" : entity.getBizId());
    }

    /**
     * 临期批次（按到期时间从近到远）。
     *
     * @param withinDays 只看这么多天内到期的
     * @param limit      最多几条
     */
    public List<Lot> listExpiring(long userId, int withinDays, int limit) {
        return mapper.listExpiring(userId, withinDays, limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /** 冻结：预扣用。**只动 frozen**，remaining 不动——钱还没花掉，只是不能用了。 */
    public void addFrozen(long lotId, long amount) {
        mapper.addFrozen(lotId, amount);
    }

    /** 解冻：返还用。**只动 frozen**，且保留批次原有的有效期。 */
    public void releaseFrozen(long lotId, long amount) {
        mapper.releaseFrozen(lotId, amount);
    }

    /**
     * 核销：把已到期的可用量从 {@code remaining} 扣掉，**冻结部分不动**。
     *
     * <p>只动 {@code remaining}，且金额由调用方按 {@link #lockById} 读到的快照算好传入——
     * 见 {@link CreditLotMapper#expireLot}。
     */
    public void expire(long lotId, long amount) {
        mapper.expireLot(lotId, amount);
    }

    /**
     * 结算：解冻并实扣。
     *
     * <p>{@code frozenTake} 是预扣时锁定的量，{@code actualTake} 是实际消耗的量。
     * 两者可以不等（部分成功 / 缓存命中）——差额自动回到可用余额。
     */
    public void settle(long lotId, long frozenTake, long actualTake) {
        mapper.settle(lotId, frozenTake, actualTake);
    }

    /**
     * 发放一个批次。
     *
     * @param grantKey 发放幂等键；重复发放靠唯一索引拦下（不靠应用层判重）
     * @throws org.springframework.dao.DuplicateKeyException 幂等键已存在
     */
    public long grant(long userId, CreditSource source, long amount, Instant expiresAt,
                      String bizType, String bizId, String grantKey) {
        CreditLotEntity entity = new CreditLotEntity();
        entity.setUserId(userId);
        entity.setSource(source.key());
        // 冗余列：把优先级固化在插入时，SQL 里就不必用 FIELD(source, ...) 硬编码顺序
        entity.setSourcePriority(source.priority());
        entity.setAmount(amount);
        entity.setRemaining(amount);
        entity.setFrozen(0L);
        entity.setExpiresAt(DbTime.toDb(expiresAt));
        entity.setBizType(bizType);
        entity.setBizId(bizId);
        entity.setGrantKey(grantKey);
        // IdType.AUTO：插入后主键回填到实体上，不必再查 LAST_INSERT_ID()
        mapper.insert(entity);
        return entity.getId();
    }

    /** 该批次的可用量——结算分配时防超扣。 */
    public long availableOf(long lotId) {
        CreditLotEntity entity = mapper.selectById(lotId);
        return entity == null ? 0L : entity.getRemaining() - entity.getFrozen();
    }

    /**
     * 该批次的来源。
     *
     * <p>结算时按批次逐个判定消耗记 {@code revenue}（付费）还是 {@code cost}（赠送）——
     * 一笔任务可能同时吃掉两种来源的批次，**不能整单一个科目**（《计费逻辑详细设计》§3 注）。
     */
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
                // 取 version 的语句都显式 SELECT 了它；缺列时的 0 只是兜底，
                // 不会造成「同一批次的两次核销撞同一个幂等键」以外的后果（那也只是漏销一次）
                entity.getVersion() == null ? 0 : entity.getVersion());
    }
}
