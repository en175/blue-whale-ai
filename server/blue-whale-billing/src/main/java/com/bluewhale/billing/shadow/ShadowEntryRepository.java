package com.bluewhale.billing.shadow;

import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.domain.entity.ShadowEntryEntity;
import com.bluewhale.billing.infrastructure.mapper.ShadowEntryMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 影子计价记录的持久化（《迁移与切换 runbook》§3.2）。
 *
 * <p><b>只记不扣</b>是本仓库的全部语义：这里没有任何一条语句会碰批次或账本。
 * 影子期的数字一分钱都没动过——这也是它敢每天跑成千上万次的原因。
 */
@Repository
public class ShadowEntryRepository {

    /** 记不下就是记不下：调 count 用。 */
    private static final int BREAKDOWN_LIMIT = 50;

    /** priced：算出了价。 */
    public static final String STATUS_PRICED = "priced";
    /** unpriceable：**成功记录的一种**——影子期的漏配清单就是它。 */
    public static final String STATUS_UNPRICEABLE = "unpriceable";

    private final ShadowEntryMapper mapper;
    private final JdbcTemplate jdbc;

    public ShadowEntryRepository(ShadowEntryMapper mapper, JdbcTemplate jdbc) {
        this.mapper = mapper;
        this.jdbc = jdbc;
    }

    /**
     * 记一行影子价。
     *
     * @return false = 这个 job 已经记过（MQ 至少一次投递的重投）——**不是错误**
     */
    public boolean record(long jobId, long userId, String status, Long computedCredits,
                          Integer catalogVersion, Integer discountBp,
                          Long upstreamCostCredits, String usageJson, String errorMessage) {
        ShadowEntryEntity entity = new ShadowEntryEntity();
        entity.setGenerationJobId(jobId);
        entity.setUserId(userId);
        entity.setStatus(status);
        entity.setComputedCredits(computedCredits);
        entity.setCatalogVersion(catalogVersion);
        entity.setDiscountBp(discountBp);
        entity.setUpstreamCostCredits(upstreamCostCredits);
        entity.setUsageJson(usageJson);
        entity.setErrorMessage(errorMessage == null ? "" : errorMessage);
        try {
            mapper.insert(entity);
            return true;
        } catch (DuplicateKeyException e) {
            // 唯一索引 uk_billing_shadow_entries__job 拦下的重投。
            // 依赖数据库而不是先查后插：先查后插有 TOCTOU 窗口，
            // 而影子期是并发最高的时期（每个任务一行）。
            return false;
        }
    }

    /** 影子期总览（算出的价 vs 上游扣用户的钱）。 */
    public Map<String, Object> summarize(Instant from, Instant to) {
        return mapper.summarize(DbTime.toDb(from), DbTime.toDb(to));
    }

    /** 未配规则的 (model, task) 清单，按出现次数降序——切换前要修掉的漏配。 */
    public List<Map<String, Object>> unpriceableBreakdown(Instant from, Instant to) {
        return mapper.unpriceableBreakdown(DbTime.toDb(from), DbTime.toDb(to), BREAKDOWN_LIMIT);
    }

    /**
     * 回填上游扣用户的数（对账任务用）。
     *
     * @return 受影响行数；0 表示这个 job 没有影子行（不该发生——说明事件丢过）
     */
    public int fillUpstreamUserCredits(long jobId, long upstreamUserCredits) {
        return jdbc.update("UPDATE billing_shadow_entries SET upstream_user_credits = ? "
                + "WHERE generation_job_id = ?", upstreamUserCredits, jobId);
    }
}
