package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.TransactionMapper;
import com.bluewhale.billing.adapter.outbound.persistence.row.TransactionRow;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 用户可见流水的读侧（{@code UserTransaction} 的投影）。
 *
 * <p>它不属于任何一张表：一行流水可能来自批次（发放）、预留（消费）或账本（其余动作），
 * SQL 在 {@link TransactionMapper} 与 {@code resources/mapper/TransactionMapper.xml} 里
 * 把三者合成同一种形状——**为什么这样合并既不漏也不重，写在 XML 的头部注释里**。
 *
 * <p>本类只做 SQL 之外的三件事：把页码换算成 OFFSET、把库内墙钟换算成 {@code Instant}、
 * 把「当页」与「总数」凑成一个 {@link TransactionView.Page}。
 *
 * <h2>2026-09-30：游标 → offset</h2>
 *
 * <p>此前这里有一个把排序三元组 {@code (created_at, kind, src_id)} 编码成不透明游标的
 * {@code Cursor} 记录，理由是「调用方只能原样回传，改进排序才不是破坏性变更」。
 * 改成 offset 后它整个删掉了 —— offset 的页码与排序键无关，**没有可被依赖的存储细节**，
 * 那条理由自然消失。
 *
 * <p>⚠️ 换来的代价是真实的：翻页途中新插入的行会把后面的行整体下移，用户可能看到重复行。
 * 这是「列表要显示总条数与页码」换来的，留痕见前端对接文档 §6.2。不要因为看到这段注释
 * 就以为游标是被证明不对才换掉的。
 */
@Repository
public class TransactionRepository {

    private final TransactionMapper mapper;

    public TransactionRepository(TransactionMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 取一页流水（时间倒序）。
     *
     * @param userId     非空 = 只看该用户（用户面）；{@code null} = 全站（管理面）
     * @param typeFilter 已校验过的类型；{@code null} 或空 = 全部。可多值
     * @param size       本页最多几行（上限由应用层钳制）
     * @param page       页码，**从 1 起**；{@code < 1} 在这里被夹到 1
     */
    public TransactionView.Page listPage(Long userId, List<String> typeFilter, int size, int page) {
        // 空集合与 null 是同一个意思（全部）。在这里收敛成一种，SQL 里就只判一次。
        List<String> filter = typeFilter == null || typeFilter.isEmpty() ? null : List.copyOf(typeFilter);

        // 页码越界不报错、夹到 1：越界页码返回一页空数据比抛异常更难排查，
        // 但把 page=0 / page=-1 直接乘出负 OFFSET 会让 MySQL 报语法错。
        long offset = (long) (Math.max(page, 1) - 1) * size;

        // 当页与总数分两次读，但共用同一份 UNION 谓词（见 XML 的两个 include）。
        // 两者之间数据可能变化——这是 offset 分页固有的，不是实现缺陷。
        List<TransactionRow> rows = mapper.selectPage(userId, filter, offset, size);
        long total = mapper.countPage(userId, filter);

        return new TransactionView.Page(
                rows.stream().map(TransactionRepository::toView).toList(),
                total);
    }

    private static TransactionView toView(TransactionRow row) {
        return new TransactionView(
                row.getTxId(),
                // 管理面没有 userId 过滤，行上必须带得动归属；NULL 只可能来自脏数据
                row.getUserId() == null ? 0L : row.getUserId(),
                row.getType(),
                row.getDirection(),
                row.getTitle(),
                row.getAmount(),
                // 管理面独用：用户面适配器不投影它。只有消费行有值，其余为 null
                row.getReservedCredits(),
                // 同上，管理面独用的 join key；BFF 拿它回自己库查任务语义
                row.getGenerationJobId(),
                row.getStatus(),
                // 连接串钉了 forceConnectionTimeZoneToSession=Asia/Shanghai，
                // 取出来的 LocalDateTime 已是北京时间；换算口径只有 DbTime 一处
                DbTime.fromDb(row.getCreatedAt()),
                DbTime.fromDb(row.getSettledAt()));
    }
}
