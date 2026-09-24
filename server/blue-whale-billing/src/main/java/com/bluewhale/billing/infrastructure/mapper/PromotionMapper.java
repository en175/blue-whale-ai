package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.PromotionEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * 营销活动 Mapper —— **没有 XML，也没有自定义方法**。
 *
 * <p>取候选活动的条件是 {@code status = 'enabled' AND start_at &lt;= ? AND end_at &gt; ?}，
 * 三个等值/比较谓词，{@code LambdaQueryWrapper} 一次写完，放到 XML 里只是换个地方写样板。
 *
 * <p>⚠️ 时间窗在这里只是**粗筛**（走 {@code idx_promo__active}）。
 * 「现在是否落在时段内」必须按活动自己的时区在 Java 侧精判——
 * MySQL 的 {@code NOW()} 用会话时区，拿来比活动自带的 tz 必然是错的。
 */
@Mapper
public interface PromotionMapper extends BaseMapper<PromotionEntity> {
}
