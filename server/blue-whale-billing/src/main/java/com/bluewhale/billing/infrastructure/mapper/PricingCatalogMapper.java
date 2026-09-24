package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.PricingCatalogEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * 定价目录 Mapper。
 *
 * <p>「按版本号取」是单条件等值查询，调用方用 {@code LambdaQueryWrapper} 即可；
 * 「取当前生效版本」带 ORDER BY + LIMIT，落在 XML。
 */
@Mapper
public interface PricingCatalogMapper extends BaseMapper<PricingCatalogEntity> {

    /**
     * 取当前生效版本。
     *
     * @return 未发布任何目录时返回 null —— 调用方据此**拒绝计价**，而不是算成 0
     */
    PricingCatalogEntity selectActive();

    /**
     * 当前最大版本号；一条都没有时返回 0。
     *
     * <p>新版本号 = 它 + 1。**不用自增主键当版本号**：主键会因回滚、测试数据清理而出现空洞，
     * 而版本号要写进 job 的定价快照长期留存，空洞会让「v5 之后跳到 v9」这种历史无法解释。
     */
    int selectMaxVersion();
}
