package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.bluewhale.billing.adapter.outbound.persistence.row.TransactionRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 用户可见流水的查询 Mapper（{@code UserTransaction} 的投影）。
 *
 * <p>它不是 {@code BaseMapper}：这条查询**没有对应的表**——三类业务动作各自住在
 * 自己的权威表里（批次 / 预留 / 账本），在 SQL 里合并成一种形状，见
 * {@code resources/mapper/TransactionMapper.xml}。
 */
@Mapper
public interface TransactionMapper {

    /**
     * 取一页流水（时间倒序）。
     *
     * <p>四道条件都在 SQL 里，因为这正是「一页」的定义所在：
     * <ol>
     *   <li><b>用户</b> —— 非空 = 只看该用户（用户面）；{@code null} = 全站（管理面）</li>
     *   <li><b>游标</b> —— {@code (created_at, kind, src_id) < cursor}（三元组比较，
     *       见 XML 的注释：DATETIME 只到秒，必须有稳定的次级键）</li>
     *   <li><b>类型过滤</b> —— {@code null} = 全部</li>
     *   <li><b>LIMIT</b> —— 传 {@code 期望条数 + 1}，多出来的那一条只用来判断
     *       「还有没有下一页」（{@code PageResponse} 只有 next_page_token，
     *       没有总数可填）</li>
     * </ol>
     *
     * @param userId     {@code null} = 全站（管理端）；非空 = 只看该用户
     * @param cursorTime 游标的时刻；{@code null} = 首页
     * @param cursorKind 游标的来源段；与 {@code cursorTime} 同生共死
     * @param cursorId   游标的行 id；同上
     */
    List<TransactionRow> selectPage(@Param("userId") Long userId,
                                    @Param("typeFilter") String typeFilter,
                                    @Param("cursorTime") LocalDateTime cursorTime,
                                    @Param("cursorKind") String cursorKind,
                                    @Param("cursorId") long cursorId,
                                    @Param("limit") int limit);
}
