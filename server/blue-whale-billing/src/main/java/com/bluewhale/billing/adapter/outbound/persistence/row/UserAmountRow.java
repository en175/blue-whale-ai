package com.bluewhale.billing.adapter.outbound.persistence.row;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 「用户 → 一个标量」的批量读模型行（按 {@code user_id} 分组的聚合取数的共同返回）。
 *
 * <p>它服务于管理端用户列表：那一页一次要问一批用户（当前页最多 100 个），逐个去问
 * 就是 N+1 次跨进程往返。所以批量版的聚合一律 {@code WHERE user_id IN (...)} +
 * {@code GROUP BY user_id}，返回若干行「用户 → 一个数」，由调用方并成一列。
 *
 * <p>⚠️ {@code amount} 的**口径由具体语句决定**（可用余额 / 某来源发放合计 /
 * 已结算消耗），本类只承载形状。别把它当成一个有固定含义的「金额」。
 *
 * <p>⚠️ **没有匹配行的用户不会出现在结果里**，而不是出现一行 0 —— 这是 SQL
 * {@code GROUP BY} 的语义。需要补零的是调用方（{@link #toMap} 不补），因为
 * 「补哪些 id」只有手里有请求清单的那一层才知道。
 */
public class UserAmountRow {

    /** 用户 id。 */
    private Long userId;

    /** 该用户的这个标量（整数积分，口径见具体语句）。 */
    private Long amount;

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getAmount() { return amount; }
    public void setAmount(Long amount) { this.amount = amount; }

    /**
     * 把行列表并成 {@code user_id → 标量} 的映射。
     *
     * <p>放在这里而不是各仓储各写一份：SQL 返回的是行、调用方要的是映射，这个转换
     * 与语句口径无关，两边重复写只会多一处要同步的兜底。
     */
    public static Map<Long, Long> toMap(List<UserAmountRow> rows) {
        Map<Long, Long> result = new HashMap<>();
        for (UserAmountRow row : rows) {
            // SUM 在没有匹配行时返回 NULL（已由 SQL 的 COALESCE 兜住）；
            // 这里再兜一次是因为行类型允许 null，而下游拆箱会当场炸
            result.put(row.getUserId(), row.getAmount() == null ? 0L : row.getAmount());
        }
        return result;
    }
}
