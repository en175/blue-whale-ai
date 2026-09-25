package com.bluewhale.billing.ledger;

import com.bluewhale.billing.application.TransactionView;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.infrastructure.mapper.TransactionMapper;
import com.bluewhale.billing.infrastructure.mapper.TransactionRow;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;

/**
 * 用户可见流水的读侧（{@code UserTransaction} 的投影）。
 *
 * <p>它不属于任何一张表：一行流水可能来自批次（发放）、预留（消费）或账本（其余动作），
 * SQL 在 {@link TransactionMapper} 与 {@code resources/mapper/TransactionMapper.xml} 里
 * 把三者合成同一种形状——**为什么这样合并既不漏也不重，写在 XML 的头部注释里**。
 *
 * <p>本类只做三件 SQL 之外的事：把分页游标与「排序三元组」互相转换、
 * 多取一条判断有没有下一页、把库内墙钟换算成 {@code Instant}。
 *
 * <h2>游标为什么编码成不透明字符串</h2>
 *
 * 游标里装的是排序键 {@code (created_at, kind, src_id)}——它由 SQL 的 ORDER BY 定义，
 * 是**存储细节**。若把这三个字段直接摊在 {@code PageResponse} 上（proto 里只有一个
 * {@code string page_token}），调用方就会开始拼它、并对排序键的构成形成依赖，
 * 将来改进排序即变成破坏性变更。编码后调用方只能原样回传。
 */
@Repository
public class TransactionRepository {

    /** 游标版本号：将来换排序键时，旧游标能被认出来并拒绝，而不是被误当成新格式解析。 */
    private static final String CURSOR_VERSION = "1";
    private static final String CURSOR_SEPARATOR = "|";

    private final TransactionMapper mapper;

    public TransactionRepository(TransactionMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 取一页流水（时间倒序）。
     *
     * @param userId     非空 = 只看该用户（用户面）；{@code null} = 全站（管理面）
     * @param typeFilter 已校验过的类型；空串 = 全部
     * @param size       本页最多几行（上限由应用层钳制）
     * @param pageToken  上一页返回的游标；空串 = 首页
     */
    public TransactionView.Page listPage(Long userId, String typeFilter, int size, String pageToken) {
        Cursor cursor = pageToken.isEmpty() ? null : Cursor.decode(pageToken);

        // 多取一条：PageResponse 只有 next_page_token，没有总数可填，
        // 「还有没有下一页」只能靠「本页之后是否还取到了行」来判断。
        List<TransactionRow> rows = mapper.selectPage(
                userId,
                typeFilter.isEmpty() ? null : typeFilter,
                cursor == null ? null : cursor.time(),
                cursor == null ? null : cursor.kind(),
                cursor == null ? 0L : cursor.srcId(),
                size + 1);

        boolean hasMore = rows.size() > size;
        List<TransactionRow> items = hasMore ? rows.subList(0, size) : rows;
        return new TransactionView.Page(
                items.stream().map(TransactionRepository::toView).toList(),
                hasMore ? Cursor.of(items.get(items.size() - 1)).encode() : "");
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
                row.getStatus(),
                // 连接串钉了 forceConnectionTimeZoneToSession=Asia/Shanghai，
                // 取出来的 LocalDateTime 已是北京时间；换算口径只有 DbTime 一处
                DbTime.fromDb(row.getCreatedAt()),
                DbTime.fromDb(row.getSettledAt()));
    }

    /**
     * 分页游标 = ORDER BY 的三元组 {@code (created_at, kind, srcId)}。
     *
     * <p>三样缺一不可：DATETIME 只到秒，同一秒内多行是常态，只带时间会跳行或重复行。
     * 时刻存成 **epoch 秒**而不是格式化字符串：库内墙钟 → {@code Instant} → 秒
     * 是无损的单向映射（本表的时间列精度就是秒），回程由 {@code DbTime} 还原成
     * 同一个北京时间的墙钟值。
     */
    private record Cursor(LocalDateTime time, String kind, long srcId) {

        static Cursor of(TransactionRow row) {
            return new Cursor(row.getCreatedAt(), row.getKind(), row.getSrcId());
        }

        String encode() {
            String raw = String.join(CURSOR_SEPARATOR,
                    CURSOR_VERSION,
                    String.valueOf(DbTime.fromDb(time).getEpochSecond()),
                    kind,
                    String.valueOf(srcId));
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        }

        static Cursor decode(String token) {
            String raw;
            try {
                raw = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw invalidToken(token);
            }
            String[] parts = raw.split("\\" + CURSOR_SEPARATOR, -1);
            if (parts.length != 4 || !CURSOR_VERSION.equals(parts[0])) {
                throw invalidToken(token);
            }
            try {
                return new Cursor(
                        DbTime.toDb(Instant.ofEpochSecond(Long.parseLong(parts[1]))),
                        parts[2],
                        Long.parseLong(parts[3]));
            } catch (NumberFormatException | DateTimeException e) {
                throw invalidToken(token);
            }
        }

        /**
         * ⚠️ 坏游标**必须报错**，不能当成首页悄悄重来：那会让调用方在翻页途中
         * 拿到第一页，表现为列表「自己跳回顶部」，且任何日志里都看不出异常。
         */
        private static IllegalArgumentException invalidToken(String token) {
            return new IllegalArgumentException("分页游标无法解析：" + token);
        }
    }
}
