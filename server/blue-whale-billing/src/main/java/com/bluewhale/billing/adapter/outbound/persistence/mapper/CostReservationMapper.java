package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CostReservationEntity;
import com.bluewhale.billing.adapter.outbound.persistence.row.StaleReservationRow;
import com.bluewhale.billing.adapter.outbound.persistence.row.UserAmountRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

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

    /**
     * 置为已结算，落两个数。
     *
     * <p>{@code actualCredits} 是**真实用量成本**、{@code receivableCredits} 是其中
     * **没收到的那部分**（见 V9 迁移）。两者一次写入，因为它们出自同一次结算的同一个判断
     * （{@code receivable = max(0, actual − reserved)}）——分两次写就会出现「有欠费列
     * 却没有对应账本腿」的窗口。
     *
     * @param actualCredits    实际消耗（积分）
     * @param receivableCredits 欠费额（积分），无超扣时为 0
     */
    int markSettled(@Param("jobId") long jobId,
                    @Param("actualCredits") long actualCredits,
                    @Param("receivableCredits") long receivableCredits);

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

    /**
     * 批量版的 {@link #sumSettledActualCredits}：一次问一批用户的已结算消耗
     * （管理端用户列表的「累计消费」列）。
     *
     * <p>⚠️ 口径与上面那条**逐字相同**（{@code status = 'settled'} +
     * {@code SUM(actual_credits)}），只把「时间区间」换成「{@code user_id IN}」——
     * 统计口径必须是同一个，否则列表页按用户的合计与仪表盘的全站合计对不上，
     * 而两边都不报错。
     *
     * <p>⚠️ 只 {@code IN} 不给区间：列表页要的是**累计**（从注册至今），不是某段时间。
     * 走 {@code idx_reservation__user (user_id, gmt_create)}（见 V7 迁移），
     * 前导列等值 + IN 是索引区间扫描。
     *
     * @param userIds 一批用户 id。**调用方须保证非空** —— 空集合会拼出 {@code IN ()}
     *                这个语法错误；本层不兜底（理由同 {@code CreditLotMapper#sumAvailableByUser}）
     */
    List<UserAmountRow> sumSettledActualByUser(@Param("userIds") List<Long> userIds);

    /**
     * 扫出「持有超过 {@code seconds} 秒仍未终态」的预留，最早持有的在前
     * （《计费逻辑详细设计》§9 层次②）。
     *
     * <p>这条扫描是**必需的而不是可选的**：MQ 重投有次数上限（18 次进死信），
     * 超限之后**再没有任何人会去解冻那笔钱**——用户看到的是「处理中」永不结束，
     * 而余额里有一块再也用不了。billing 扫自己的表，不依赖任何外部服务。
     *
     * <p>为什么用 {@code gmt_modified} 判「持有多久」：这一列是**这行最后一次变化的时刻**，
     * 而 held 的行只可能由「预扣」写进去（结算 / 释放都会把状态改走，便不再命中
     * {@code status = 'held'}），所以对 held 行来说它就等于预扣那一刻。顺带还能走
     * {@code idx_reservation__status (status, gmt_modified)}——第一条相等谓词收窄到 held，
     * 第二条正好接上这里的范围条件。
     *
     * <p>⚠️ 时间全部在 SQL 侧算（{@code NOW()} / {@code TIMESTAMPDIFF}），不接受 Java 传来的
     * 时间点：会话时区被钉成北京时间（见 {@code DbTime}），JVM 的时钟是另一个。
     * 判定「用户的钱冻了多久」只能有一个时钟——两个时钟混用，冻结时长会凭空伸缩。
     *
     * @param seconds 阈值（秒）
     * @param limit   本轮最多取几条。**必须有限**：一次扫出几万行会让调度线程长时间占住，
     *                而按「最久优先」排序 + 每轮重扫，下一轮自然接着处理剩下的，不会饥饿
     */
    List<StaleReservationRow> listStaleHeld(@Param("seconds") long seconds,
                                            @Param("limit") int limit);
}
