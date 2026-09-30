package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.bluewhale.billing.adapter.outbound.persistence.row.TransactionRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 用户可见流水的查询 Mapper（{@code UserTransaction} 的投影）。
 *
 * <p>它不是 {@code BaseMapper}：这条查询**没有对应的表**——三类业务动作各自住在
 * 自己的权威表里（批次 / 预留 / 账本），在 SQL 里合并成一种形状，见
 * {@code resources/mapper/TransactionMapper.xml}。
 *
 * <p>两个方法**必须共用同一份 UNION 谓词**：{@link #countPage} 与 {@link #selectPage}
 * 在 XML 里 include 同一个 {@code transactionUnion} 片段。「共 N 条」与当页的行
 * 出自两套各写一遍的 SQL 时，改了一边忘了另一边不会报错，只会让数字对不上。
 */
@Mapper
public interface TransactionMapper {

    /**
     * 取一页流水（时间倒序）。
     *
     * <p>四道条件都在 SQL 里，因为这正是「一页」的定义所在：
     * <ol>
     *   <li><b>用户</b> —— 非空 = 只看该用户（用户面）；{@code null} = 全站（管理面）</li>
     *   <li><b>类型过滤</b> —— 空集合 = 全部；多值用 {@code IN}（见 XML 的
     *       {@code transactionTypeFilter}）</li>
     *   <li><b>OFFSET</b> —— {@code (page - 1) * pageSize}，由调用方算好传入</li>
     *   <li><b>LIMIT</b> —— 本页条数。**不再多取一条**：有没有下一页由
     *       {@link #countPage} 的总数算得出来，不必再靠「多取一行」猜</li>
     * </ol>
     *
     * @param userId     {@code null} = 全站（管理端）；非空 = 只看该用户
     * @param typeFilter 已校验过的类型；{@code null} 或空集合 = 全部
     * @param offset     跳过多少行；由应用层的页码换算，不在 SQL 里做乘法
     * @param limit      本页最多几行（上限由应用层钳制）
     */
    List<TransactionRow> selectPage(@Param("userId") Long userId,
                                    @Param("typeFilter") List<String> typeFilter,
                                    @Param("offset") long offset,
                                    @Param("limit") int limit);

    /**
     * 满足同一组条件的总行数（「共 N 条」）。
     *
     * <p>⚠️ 它与 {@link #selectPage} **不是两个查询**，是同一个查询的两种读出：
     * XML 里两者 include 同一份 UNION 与同一个类型过滤。所以这个方法**必须**接收
     * 与 {@code selectPage} 完全一样的 {@code userId} / {@code typeFilter} —
     * 少传一个，总数就会数进用户看不见的行。
     *
     * <p>⚠️ 成本：账本是全表增长最快的一张，这条 COUNT 随数据量线性上涨。
     * 它是「列表要显示总数」的直接代价，见前端对接文档 §6.2。
     */
    long countPage(@Param("userId") Long userId,
                   @Param("typeFilter") List<String> typeFilter);
}
