package com.bluewhale.billing.ledger;

import java.util.List;

/**
 * 预扣预留（《计费逻辑详细设计》§2.4 / §5.1）。
 *
 * <p>它是**内部记录**，不暴露给用户端任何接口——用户只应看到「处理中 · 预计消耗 40」
 * 与「已完成 · 消耗 30」两个状态，不该知道中间存在过一笔预留。
 *
 * @param reservedCredits 预扣额（mc）
 * @param actualCredits   实际额（mc）；未结算时为 null
 * @param status          状态机见 {@link Status}
 * @param allocations     预扣分配的批次明细；结算与返还**按同一份**处理
 * @param catalogVersion  冻结的定价版本——改价不影响已提交任务
 * @param releaseNote     释放原因；仅 released 时有值
 */
public record Reservation(
        long id,
        long jobId,
        long userId,
        long reservedCredits,
        Long actualCredits,
        Status status,
        List<Allocation> allocations,
        int catalogVersion,
        String releaseNote
) {

    /** 预留状态机（《计费逻辑详细设计》§5.1）。 */
    public enum Status {

        /** 已预扣，等待结算或返还。 */
        HELD("held"),

        /** 已结算（含部分消耗）。 */
        SETTLED("settled"),

        /** 已释放（任务失败全额返，或超时兜底）。 */
        RELEASED("released");

        private final String key;

        Status(String key) {
            this.key = key;
        }

        public String key() {
            return key;
        }

        public static Status of(String key) {
            for (Status status : values()) {
                if (status.key.equals(key)) {
                    return status;
                }
            }
            throw new IllegalArgumentException("未知的预留状态：" + key);
        }
    }

    /** 是否处于「未决」态——只有它才能被结算或返还，重复调用必须是无操作。 */
    public boolean isPending() {
        return status == Status.HELD;
    }
}
