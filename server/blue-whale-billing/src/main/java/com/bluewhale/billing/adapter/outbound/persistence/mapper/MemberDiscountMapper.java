package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.MemberDiscountEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * 会员等级折扣 Mapper —— **没有 XML，也没有自定义方法**。
 *
 * <p>取候选的条件是 {@code tier = ? AND status = 'enabled'}，两个等值谓词
 * （走 {@code idx_member_disc__lookup}），{@code LambdaQueryWrapper} 足够。
 *
 * <p>⚠️ 用 {@code tier} 而非 {@code user_id} 过滤：同一等级共享同一批规则，结果可整体缓存。
 */
@Mapper
public interface MemberDiscountMapper extends BaseMapper<MemberDiscountEntity> {
}
