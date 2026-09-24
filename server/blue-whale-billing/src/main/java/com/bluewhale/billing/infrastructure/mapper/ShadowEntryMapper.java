package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.ShadowEntryEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 影子计价记录的 Mapper。
 *
 * <p>单行读写（插入、按 job 查）由 {@link BaseMapper} 提供；汇总查询带聚合，
 * 落在 {@code resources/mapper/ShadowEntryMapper.xml}。
 */
@Mapper
public interface ShadowEntryMapper extends BaseMapper<ShadowEntryEntity> {

    /**
     * 影子期的总览：算出的价 vs 上游扣用户的钱。
     *
     * <p>返回单行。字段直接按列名取：
     * <ul>
     *   <li>{@code priced} / {@code unpriceable} —— 分别多少条</li>
     *   <li>{@code computed_credits} —— 我们算的合计</li>
     *   <li>{@code upstream_user_credits} —— 上游扣用户的合计（未回填的行不计）</li>
     * </ul>
     */
    Map<String, Object> summarize(@Param("from") LocalDateTime from,
                                  @Param("to") LocalDateTime to);

    /**
     * 未配规则的 (model, task) 清单 —— **切换前要修掉的漏配**。
     *
     * <p>按出现次数降序：先修最常被碰到的。
     */
    List<Map<String, Object>> unpriceableBreakdown(@Param("from") LocalDateTime from,
                                                   @Param("to") LocalDateTime to,
                                                   @Param("limit") int limit);
}
