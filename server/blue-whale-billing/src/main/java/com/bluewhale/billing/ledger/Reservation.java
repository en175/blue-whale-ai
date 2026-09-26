package com.bluewhale.billing.ledger;

import java.util.List;

/**
 * 预扣预留（《计费逻辑详细设计》§2.4 / §5.1）。
 *
 * <p>它是**内部记录**，不暴露给用户端任何接口——用户只应看到「处理中 · 预计消耗 40」
 * 与「已完成 · 消耗 30」两个状态，不该知道中间存在过一笔预留。
 *
 * @param reservedCredits 预扣额（积分）
 * @param actualCredits   实际额（积分）；未结算时为 null。
 *                        ⚠️ 它是**真实用量成本**，可能**大于** reservedCredits
 *                        （按 token 估的预扣偏低是预期内的），不是「用户被扣走的」
 * @param receivableCredits 欠费额（积分，见 V9 迁移）——actualCredits 里**没收到**的那部分，
 *                        也就是「实际 > 预扣」的差额；无超扣时为 0。
 *                        用户实际被扣走的是 {@code actual − receivable}（二者之差就是预扣额）。
 *                        它与账本 {@code RECEIVABLE} 那一腿同数，见 {@link CreditService#settle}
 * @param status          状态机见 {@link Status}
 * @param allocations     预扣分配的批次明细；结算与返还**按同一份**处理
 * @param catalogVersion  冻结的定价版本——只作追溯（当时按哪一版目录的换算率/折扣策略）；
 *                        ⚠️ 它**不再**用于复现规则，规则见下面那条
 * @param discountBp      冻结的折扣系数（万分比）——改折扣不影响已提交任务。
 *                        与 catalogVersion 是同一件事的两半：一个冻结「当时是哪一版目录」，
 *                        一个冻结「当时打了多少折」
 * @param ruleSnapshot    ★ 冻结的**规则本身**（JSON 文本，形态见 {@code CatalogCompiler
 *                        #compileRuleSnapshot}）；{@code null} = 本次预扣没带快照。
 *                        规则已从定价目录搬进模型能力行（backend 的
 *                        {@code generation_model_capability.pricing}），而 billing 读不到那个库
 *                        （ADR-0114 不共享库），所以由属主在 Hold 时随请求送来、这里冻下来——
 *                        它就是结算复现定价的**唯一**来源。
 *                        <p>⚠️ {@code null} 不是「无需规则」，而是「**算不出价**」：
 *                        结算会抛出去让 MQ 重投（→ 死信 → 有人看得见），
 *                        既不按 0 也不按预扣额蒙。
 * @param title           提交时的展示文案快照（{@code HoldRequest.title}），用户流水直接展示。
 *                        存快照而不是引用：模型改名、文案生成规则变化都不该改写历史流水
 * @param releaseNote     释放原因；仅 released 时有值
 */
public record Reservation(
        long id,
        long jobId,
        long userId,
        long reservedCredits,
        Long actualCredits,
        long receivableCredits,
        Status status,
        List<Allocation> allocations,
        int catalogVersion,
        int discountBp,
        String ruleSnapshot,
        String title,
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
