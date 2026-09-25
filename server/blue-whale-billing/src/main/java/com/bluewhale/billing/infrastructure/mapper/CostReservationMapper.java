package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.CostReservationEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;

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

    /**
     * 区间内**已结算**的实际消耗合计（管理端仪表盘用）。
     *
     * <p>走 {@code idx_reservation__status (status, gmt_modified)}——第一条相等谓词（status）
     * 之后的第二列正好是区间列，是一条索引区间扫描，不是全表扫。
     *
     * <p>⚠️ 区间按 {@code gmt_modified} 划：这张表**没有 settled_at 列**，而
     * {@code ON UPDATE CURRENT_TIMESTAMP} 让「结算那一刻」落在 {@code gmt_modified} 上。
     * 用户流水的 {@code settled_at} 用的就是它（见 {@code TransactionMapper.xml} 的 ② 段），
     * 这里与那条口径一致——两处若各挑一列，仪表盘与消费记录页的数会对不上。
     *
     * <p>⚠️ 只算 {@code settled}：{@code held} 的钱还冻着、{@code released} 的钱原样退回，
     * 两者都不是消耗。
     *
     * @param from 含
     * @param to   不含（半开区间；DATETIME 只到秒，{@code BETWEEN ... AND 23:59:59}
     *             会漏掉最后一秒里的行）
     */
    long sumSettledActualCredits(@Param("from") LocalDateTime from,
                                 @Param("to") LocalDateTime to);
}
