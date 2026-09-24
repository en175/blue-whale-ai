package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.CostReservationEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 预扣预留 Mapper。
 *
 * <p>结算与返还都会走 {@link #lockByJobId} 拿行锁：这两条路径会并发到达
 * （任务完成回调 vs 超时兜底扫描），没有锁就会各自读到 {@code held}、各自解冻一次，
 * 同一笔钱退两遍。
 */
@Mapper
public interface CostReservationMapper extends BaseMapper<CostReservationEntity> {

    /** 取出并锁住该 job 的预留；不存在返回 null。 */
    CostReservationEntity lockByJobId(@Param("jobId") long jobId);

    int markSettled(@Param("jobId") long jobId, @Param("actualCredits") long actualCredits);

    int markReleased(@Param("jobId") long jobId, @Param("releaseNote") String releaseNote);
}
